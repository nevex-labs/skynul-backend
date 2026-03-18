/**
 * TaskRunner — the agent loop for a single task.
 *
 * 1. Create WindowsBridge
 * 2. Screenshot → send to model with history
 * 3. Model responds with JSON action
 * 4. Execute action via bridge
 * 5. Record step (screenshot + action + result)
 * 6. Push update to renderer
 * 7. Repeat until done, fail, timeout, or max steps
 */

import type { ProviderId, Task, TaskAction, TaskStep } from '../../types';
import { writeFile } from "fs/promises";
import os from "os";
import type { BrowserEngine } from "../browser/engine/browser-engine";
import { acquireBrowserEngine } from "../browser/engine/factory";
import { PolymarketClient } from "../polymarket-client";
import {
  codexVisionRespond,
  type VisionMessage,
} from "../providers/codex-vision";
import { generateImage } from "../providers/image-gen";
import { parseModelResponse } from "./action-parser";
import { AppBridge } from "./app-bridge";
import { createExcelFromTsv } from "./excel-writer";
import {
  buildBrowserSystemPrompt,
  buildCdpSystemPrompt,
  buildCodeSystemPrompt,
} from "./system-prompt";
import { deleteFact, saveFact } from "./task-memory";
import { scrapeUrl } from "./web-scraper";

/** Keep head+tail of long text so the model sees both beginning and end. */
function headTail(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const head = Math.floor(limit * 0.6);
  const tail = limit - head;
  const omitted = text.length - head - tail;
  return `${text.slice(0, head)}\n\n[... ${omitted} chars omitted ...]\n\n${text.slice(text.length - tail)}`;
}

export type TaskRunnerCallbacks = {
  onUpdate: (task: Task) => void;
};

export type TaskRunnerOpts = {
  provider: ProviderId;
  openaiModel: string;
  memoryContext?: string;
  taskManager?: import("./task-manager").TaskManager | null;
  taskId?: string;
};

export class TaskRunner {
  private aborted = false;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private task: Task;
  private lastScrapeData = "";
  /** Best-effort accumulated token usage (when provider returns usage). */
  private usageTotals: { inputTokens: number; outputTokens: number } | null =
    null;
  private appBridge = new AppBridge();
  private autoDelegated = false;

  private shouldAutoDelegate(prompt: string): boolean {
    const p = prompt.toLowerCase();
    const wantsPost =
      /(\bpost\b|\btweet\b|\bpublish\b|poste(a|ar)|public(a|ar)|borrador|draft)/.test(
        p,
      );
    const wantsX = /(\bx\b|twitter|x\.com)/.test(p);
    const wantsImage =
      /(\bimage\b|\bimagen\b|\bmeme\b|\bpicture\b|\bgenerate\b.*\bimage\b)/.test(
        p,
      );
    const wantsCopy =
      /(\bcopy\b|caption|two\s*lines|2\s*lines|dos\s*lineas|hashtags|cta)/.test(
        p,
      );
    return (
      (wantsPost && wantsX && wantsImage && wantsCopy) ||
      (wantsPost && wantsImage && wantsCopy)
    );
  }

  private async autoDelegateForSocialPost(
    history: VisionMessage[],
  ): Promise<void> {
    if (this.autoDelegated) return;
    const tm = this.opts.taskManager;
    if (!tm) return;
    if (this.task.parentTaskId) return;
    if (!this.shouldAutoDelegate(this.task.prompt)) return;

    this.autoDelegated = true;

    this.pushStatus("Setting up multi-agent plan (Copy + Design)...");

    const copyPrompt =
      "You MUST respond using the Skynul agent JSON protocol (thought + action). " +
      'Return ONE JSON object only. action.type MUST be "done". ' +
      'action.summary must contain plain text with: 3 numbered options (TWO lines each) and then "Recommended:". ' +
      "Constraints: English, bullish BTC meme vibe, short and punchy, subtle Argentine wink, avoid spam/repeated hashtags.";
    const designPrompt =
      "You MUST respond using the Skynul agent JSON protocol (thought + action). " +
      'Return ONE JSON object only. action.type MUST be "done". ' +
      "action.summary must contain plain text with: (1) image-gen prompt, (2) on-image text, (3) composition notes, (4) aspect ratio for X.";

    const [copyRes, designRes] = await Promise.all([
      tm.spawnAndWait(copyPrompt, [], this.task.id, { agentRole: "Copy" }),
      tm.spawnAndWait(designPrompt, [], this.task.id, { agentRole: "Design" }),
    ]);

    history.push({
      role: "user",
      content: [
        {
          type: "input_text",
          text:
            `Sub-agent outputs (use these; do NOT redo):\n` +
            `- Copy (${copyRes.taskId}): ${copyRes.output}\n` +
            `- Design (${designRes.taskId}): ${designRes.output}\n\n` +
            `Now execute the full flow in X: open composer, generate/upload image based on Design, paste final chosen copy, and POST.`,
        },
      ],
    });
  }

  constructor(
    task: Task,
    private opts: TaskRunnerOpts,
    private callbacks: TaskRunnerCallbacks,
  ) {
    this.task = { ...task };
  }

  /**
   * Run the agent loop. Resolves when the task is done, failed, or cancelled.
   */
  async run(): Promise<Task> {
    // Code mode — text-only loop, no bridge/screenshots
    if (this.task.mode === "code") {
      return this.runCode();
    }

    // API-only tasks (Polymarket) → text loop, no browser
    if (this.task.capabilities.includes("polymarket.trading")) {
      return this.runCdp();
    }

    // Everything else → browser snapshot-based loop (generic, works on any site)
    return this.runBrowser();
  }

  /**
   * Snapshot-based browser agent loop — generic browser automation.
   * The model sees a text snapshot of the page each turn and decides actions.
   */
  private async runBrowser(): Promise<Task> {
    this.pushStatus("Launching browser...");

    let engine: BrowserEngine;
    let release: (() => Promise<void>) | null = null;
    try {
      const acquired = await acquireBrowserEngine();
      engine = acquired.engine;
      release = acquired.release;
      this.pushStatus("Browser ready");
    } catch (e) {
      return this.finish(
        "failed",
        `Browser launch failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    if (this.aborted) {
      if (release) await release().catch(() => {});
      return this.finish("cancelled");
    }

    this.timeoutHandle = setTimeout(() => {
      this.abort("Task timed out");
    }, this.task.timeoutMs);

    const systemPrompt = buildBrowserSystemPrompt(!!this.task.parentTaskId);
    const history: VisionMessage[] = [];

    const memCtx = this.opts.memoryContext
      ? `\n\nContext from memory:\n${this.opts.memoryContext}`
      : "";

    // Resolve attachments: save data URLs to temp files so agent can upload_file them
    const { filePaths: attachPaths, dataUrls: attachDataUrls } =
      await this.resolveAttachments();
    const attachBlock =
      attachPaths.length > 0
        ? `\n\nReference files (use upload_file with these paths to upload them to any site):\n${attachPaths.map((p) => `- ${p}`).join("\n")}`
        : "";

    await this.autoDelegateForSocialPost(history);

    try {
      for (let step = 0; step < this.task.maxSteps && !this.aborted; step++) {
        // Take a snapshot of the current page
        const snap = await engine.snapshot().catch(() => ({
          url: "",
          title: "",
          snapshot: "(page not available)",
        }));

        // Build action history + failed selectors blacklist
        let actionLog = "";
        if (this.task.steps.length > 0) {
          const recent = this.task.steps.slice(-8);
          actionLog =
            "\n\nRecent actions:\n" +
            recent
              .map((s) => {
                const res = s.result ? ` → ${s.result.slice(0, 200)}` : "";
                const err = s.error ? ` [ERROR: ${s.error.slice(0, 100)}]` : "";
                // Surface truncation feedback so the model knows to be concise
                const truncNote = s.thought?.includes("truncated")
                  ? " [YOUR RESPONSE WAS TRUNCATED — keep thought under 30 words]"
                  : "";
                return `Step ${s.index + 1}: ${s.action.type}${res}${err}${truncNote}`;
              })
              .join("\n") +
            "\n\nDo NOT repeat actions that already succeeded.";

          // Collect selectors/strategies that failed — tell model to avoid them
          const failedSelectors = new Set<string>();
          for (const s of this.task.steps) {
            if (s.error) {
              const raw = s.action as Record<string, unknown>;
              if (raw.selector) failedSelectors.add(String(raw.selector));
            }
          }
          if (failedSelectors.size > 0) {
            actionLog +=
              "\n\n⚠ FAILED SELECTORS (do NOT use these again, try a completely different approach):\n" +
              [...failedSelectors].map((s) => `- ${s}`).join("\n");
          }
        }

        // Build turn message
        const turnText =
          step === 0
            ? `Task: ${this.task.prompt}${attachBlock}${memCtx}\n\nCurrent page:\nURL: ${snap.url}\nTitle: ${snap.title}\n\nPage snapshot:\n${snap.snapshot}`
            : `Step ${step + 1}.\nURL: ${snap.url}\nTitle: ${snap.title}\n\nPage snapshot:\n${snap.snapshot}${actionLog}`;

        const inboxBlock = this.drainInbox();
        const turnMessage: VisionMessage = {
          role: "user",
          content: [
            { type: "input_text", text: turnText + inboxBlock },
            ...(step === 0
              ? attachDataUrls.slice(0, 4).map((url) => ({
                  type: "input_image" as const,
                  detail: "auto" as const,
                  image_url: url,
                }))
              : []),
          ],
        };

        // Compress old turns: keep first (task prompt) + last 6 msgs (3 turns), summarize the rest
        if (history.length > 8) {
          const oldMessages = history.slice(1, history.length - 6);
          const summary = oldMessages
            .filter((m) => m.role === "assistant")
            .map((m) => {
              const txt =
                m.content?.[0] && "text" in m.content[0]
                  ? m.content[0].text
                  : "";
              const actionMatch = txt.match(/"type"\s*:\s*"([^"]+)"/);
              return actionMatch ? actionMatch[1] : "";
            })
            .filter(Boolean)
            .join(" → ");
          history.splice(1, oldMessages.length, {
            role: "user",
            content: [
              { type: "input_text", text: `[Previous actions: ${summary}]` },
            ],
          });
        }
        history.push(turnMessage);

        const { text: rawResponse, usage } = await this.callVisionModel(
          systemPrompt,
          history,
        );
        if (usage) this.addUsage(usage);
        const { thought, action } = parseModelResponse(rawResponse);

        history.push({
          role: "assistant",
          content: [{ type: "output_text", text: rawResponse }],
        });

        const taskStep: TaskStep = {
          index: this.task.steps.length,
          timestamp: Date.now(),
          screenshotBase64: "",
          action,
          thought,
        };

        if (action.type === "done") {
          this.task.summary = action.summary;
          this.task.steps.push(taskStep);
          this.pushUpdate();
          if (release) await release().catch(() => {});
          return this.finish("completed");
        }

        if (action.type === "fail") {
          this.task.steps.push(taskStep);
          this.pushUpdate();
          if (release) await release().catch(() => {});
          return this.finish("failed", action.reason);
        }

        // Execute action via browser engine
        try {
          const result = await this.executeBrowserAction(engine, action);
          if (result) taskStep.result = result;
        } catch (e) {
          taskStep.error = e instanceof Error ? e.message : String(e);
        }

        this.task.steps.push(taskStep);
        this.pushUpdate();
        await this.sleep(500);
      }
    } catch (e) {
      if (release) await release().catch(() => {});
      if (this.aborted) return this.finish("cancelled");
      return this.finish(
        "failed",
        `Browser loop error: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    if (release) await release().catch(() => {});
    if (this.aborted) return this.finish("cancelled");
    return this.finish("failed", `Reached max steps (${this.task.maxSteps})`);
  }

  /**
   * Execute a single action from the browser agent loop.
   */
  private async executeBrowserAction(
    engine: BrowserEngine,
    action: TaskAction,
  ): Promise<string | undefined> {
    const raw = action as Record<string, unknown>;
    const type = raw.type as string;
    const frameId = raw.frameId as string | undefined;
    switch (type) {
      case "navigate": {
        const navUrl = String(raw.url ?? "");
        const IMAGE_GEN_SITES: Array<{
          keywords: string[];
          domains: string[];
        }> = [
          { keywords: ["pollinations"], domains: ["pollinations.ai"] },
          {
            keywords: ["bing image", "bing create"],
            domains: ["bing.com/images/create", "bing.com/create"],
          },
          { keywords: ["craiyon"], domains: ["craiyon.com"] },
          { keywords: ["nightcafe"], domains: ["nightcafe.studio"] },
          { keywords: ["leonardo"], domains: ["leonardo.ai"] },
          { keywords: ["ideogram"], domains: ["ideogram.ai"] },
          { keywords: ["firefly"], domains: ["adobe.com/firefly"] },
          { keywords: ["dream.ai"], domains: ["dream.ai"] },
        ];
        const promptLower = this.task.prompt.toLowerCase();
        const matchedSite = IMAGE_GEN_SITES.find((s) =>
          s.domains.some((d) => navUrl.includes(d)),
        );
        if (matchedSite) {
          const userExplicitlyRequestedThisSite = matchedSite.keywords.some(
            (k) => promptLower.includes(k),
          );
          if (!userExplicitlyRequestedThisSite) {
            return `[BLOCKED] Do not navigate to image generation websites. Use the generate_image action instead: {"type":"generate_image","prompt":"..."}`;
          }
        }
        await engine.navigate(navUrl);
        await this.sleep(1500);
        break;
      }
      case "click":
        await engine.click(raw.selector as string, frameId);
        break;
      case "type":
        await engine.type(raw.selector as string, raw.text as string, frameId);
        break;
      case "pressKey":
        await engine.pressKey(raw.key as string);
        break;
      case "key":
        await engine.pressKey((raw.key as string) || (raw.combo as string));
        break;
      case "evaluate": {
        const result = await engine.evaluate(raw.script as string, frameId);
        return result || undefined;
      }
      case "upload_file": {
        const selector = raw.selector as string;
        const filePaths = raw.filePaths as string[];
        if (!selector || !Array.isArray(filePaths) || filePaths.length === 0) {
          throw new Error("upload_file requires selector + filePaths[]");
        }
        await engine.uploadFile(selector, filePaths, frameId);
        break;
      }
      case "screenshot":
        return "[BLOCKED] screenshot action is disabled — use the page snapshot text instead.";
      case "wait":
        return "[BLOCKED] wait is disabled — the engine handles timing internally. Use your next action directly.";
      case "scroll":
        await engine.evaluate(
          `window.scrollBy(0, ${(raw.direction as string) === "up" ? -400 : 400})`,
        );
        break;
      case "scrollIntoView":
        await engine.evaluate(
          `document.querySelector('${(raw.selector as string).replace(/'/g, "\\'")}')?.scrollIntoView({block:'center',behavior:'instant'})`,
          frameId,
        );
        break;
      case "app_script": {
        const result = await this.appBridge.run(
          (action as any).app,
          (action as any).script,
        );
        return result.ok ? result.output : `[AppBridge error: ${result.error}]`;
      }
      case "task_list_peers":
      case "task_send":
      case "task_read":
      case "task_message":
        return this.executeInterTaskAction(action);
      case "remember_fact":
      case "forget_fact":
        return this.executeFactAction(action);
      case "set_identity":
        return this.executeSetIdentity(action);
      case "generate_image":
        return this.executeGenerateImage(action);
      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
    return undefined;
  }

  /**
   * CDP text-based agent loop (no screenshots).
   */
  private async runCdp(): Promise<Task> {
    // Set initial status immediately, before any validation
    this.pushStatus(`Connecting to ${this.getProviderDisplayName()}...`);

    // CDP mode is now API-only (Polymarket, etc.) — browser tasks go through runBrowser().

    this.timeoutHandle = setTimeout(() => {
      this.abort("Task timed out");
    }, this.task.timeoutMs);

    this.pushStatus("Starting agent loop...");

    const systemPrompt = buildCdpSystemPrompt(
      this.task.capabilities,
      !!this.task.parentTaskId,
    );
    const history: VisionMessage[] = [];

    const memCtxCdp = this.opts.memoryContext ?? "";
    const allAttachments = (this.task.attachments ?? []).filter(
      (x) => typeof x === "string",
    );
    const imageDataUrls = allAttachments.filter((a) =>
      a.startsWith("data:image/"),
    );
    const filePaths = allAttachments.filter(
      (a) => !a.startsWith("data:image/"),
    );
    const attachmentsBlock =
      filePaths.length > 0
        ? `\n\nAttached local files (absolute paths):\n${filePaths
            .slice(0, 12)
            .map((p) => `- ${p}`)
            .join("\n")}`
        : "";
    history.push({
      role: "user",
      content: [
        {
          type: "input_text",
          text: `Task: ${this.task.prompt}${attachmentsBlock}${memCtxCdp}`,
        },
        ...imageDataUrls.slice(0, 4).map((url) => ({
          type: "input_image" as const,
          detail: "auto" as const,
          image_url: url,
        })),
      ],
    });

    while (!this.aborted && this.task.steps.length < this.task.maxSteps) {
      try {
        const stepIndex = this.task.steps.length;
        let actionLog = "";
        if (stepIndex > 0) {
          const recentSteps = this.task.steps.slice(-8);
          actionLog =
            "\n\nRecent actions:\n" +
            recentSteps
              .map((s) => {
                const desc = s.action.type;
                const resultSuffix = s.result
                  ? ` → ${s.result.slice(0, 200)}`
                  : "";
                const errorSuffix = s.error
                  ? ` [ERROR: ${s.error.slice(0, 100)}]`
                  : "";
                return `Step ${s.index + 1}: ${desc}${resultSuffix}${errorSuffix}`;
              })
              .join("\n") +
            "\n\nDo NOT repeat actions that already succeeded.";
        }

        const turnText =
          stepIndex === 0
            ? `Task: ${this.task.prompt}\n\nYou are in API-only mode. Use the polymarket_* actions directly. Do NOT use shell, navigate, or evaluate.`
            : `Step ${stepIndex + 1}.${actionLog}`;

        const inboxBlock = this.drainInbox();

        const turnMessage: VisionMessage = {
          role: "user",
          content: [{ type: "input_text", text: turnText + inboxBlock }],
        };

        // Compress old turns: keep first (task prompt) + last 6 msgs (3 turns), summarize the rest
        if (history.length > 8) {
          const oldMessages = history.slice(1, history.length - 6);
          const summary = oldMessages
            .filter((m) => m.role === "assistant")
            .map((m) => {
              const txt =
                m.content?.[0] && "text" in m.content[0]
                  ? m.content[0].text
                  : "";
              const actionMatch = txt.match(/"type"\s*:\s*"([^"]+)"/);
              return actionMatch ? actionMatch[1] : "";
            })
            .filter(Boolean)
            .join(" → ");
          history.splice(1, oldMessages.length, {
            role: "user",
            content: [
              { type: "input_text", text: `[Previous actions: ${summary}]` },
            ],
          });
        }
        history.push(turnMessage);

        const { text: rawResponse, usage } = await this.callVisionModel(
          systemPrompt,
          history,
        );
        if (usage) this.addUsage(usage);
        const { thought, action } = parseModelResponse(rawResponse);

        history.push({
          role: "assistant",
          content: [{ type: "output_text", text: rawResponse }],
        });

        const step: TaskStep = {
          index: this.task.steps.length,
          timestamp: Date.now(),
          screenshotBase64: "",
          action,
          thought,
        };

        if (action.type === "done") {
          this.task.summary = action.summary;
          this.task.steps.push(step);
          this.pushUpdate();
          return this.finish("completed");
        }

        if (action.type === "fail") {
          this.task.steps.push(step);
          this.pushUpdate();
          return this.finish("failed", action.reason);
        }

        try {
          const result = await this.executeApiOnlyAction(action);
          if (result) step.result = result;
        } catch (e) {
          step.error = e instanceof Error ? e.message : String(e);
        }

        this.task.steps.push(step);
        this.pushUpdate();
        await this.sleep(500);
      } catch (e) {
        if (this.aborted) break;
        return this.finish(
          "failed",
          `API loop error: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    if (this.aborted) return this.finish("cancelled");
    return this.finish("failed", `Reached max steps (${this.task.maxSteps})`);
  }

  /**
   * Code mode — text-only agent loop. No bridge, no screenshots.
   * Uses shell commands and API actions only.
   */
  private async runCode(): Promise<Task> {
    // Set initial status immediately
    this.pushStatus(`Connecting to ${this.getProviderDisplayName()}...`);

    // Check if aborted before setting up timeout
    if (this.aborted) {
      return this.finish("cancelled");
    }

    this.timeoutHandle = setTimeout(() => {
      this.abort("Task timed out");
    }, this.task.timeoutMs);

    this.pushStatus("Preparing agent loop...");

    const systemPrompt = buildCodeSystemPrompt(
      this.task.capabilities,
      !!this.task.parentTaskId,
    );
    const history: VisionMessage[] = [];

    const memCtx = this.opts.memoryContext ?? "";
    history.push({
      role: "user",
      content: [
        {
          type: "input_text",
          text: `Task: ${this.task.prompt}${memCtx}\n\n[CODE MODE] You have NO screen access. Do NOT use click, scroll, move, or other screen actions.${this.task.capabilities.includes("app.scripting") ? " [APP SCRIPTING ACTIVE] You MUST use app_script for design tasks. Do NOT use file_write for design files. Keep scripts under 6 lines." : " Use file_read, file_write, file_edit, file_list, file_search, and shell."}`,
        },
      ],
    });

    while (!this.aborted && this.task.steps.length < this.task.maxSteps) {
      try {
        const stepIndex = this.task.steps.length;
        let turnText: string;
        if (stepIndex === 0) {
          turnText = this.task.capabilities.includes("app.scripting")
            ? `Task: ${this.task.prompt}\n\n[APP SCRIPTING MODE] Use ONLY app_script actions. Keep scripts under 6 lines. Do NOT use file_write for design files.\n\nIMPORTANT: Take your time. Build the design in MANY small steps (10-20+ steps). Do NOT rush to save/done after 2-3 shapes. Each step should add ONE element: a shape, a color, a text, an alignment. Build up complexity gradually like a real designer would. Do NOT use "done" until the design is truly complete and polished.`
            : `Task: ${this.task.prompt}\n\n[CODE MODE] No screen. Use file_read/file_write/file_edit/file_list/file_search/shell/done/fail actions.`;
        } else {
          const recentSteps = this.task.steps.slice(-8);
          const actionLog = recentSteps
            .map((s) => {
              const a = s.action;
              let desc: string = a.type;
              if (a.type === "shell")
                desc = `shell "${(a as any).command?.slice(0, 80)}"`;
              else if (a.type === "file_read")
                desc = `file_read ${(a as any).path}`;
              else if (a.type === "file_write")
                desc = `file_write ${(a as any).path}`;
              else if (a.type === "file_edit")
                desc = `file_edit ${(a as any).path}`;
              else if (a.type === "file_list")
                desc = `file_list "${(a as any).pattern}"`;
              else if (a.type === "file_search")
                desc = `file_search "${(a as any).pattern}"`;
              const resultSuffix = s.result
                ? ` → ${s.result.slice(0, 300)}`
                : "";
              const errorSuffix = s.error
                ? ` [ERROR: ${s.error.slice(0, 100)}]`
                : "";
              return `Step ${s.index + 1}: ${desc}${resultSuffix}${errorSuffix}`;
            })
            .join("\n");
          turnText = `Step ${stepIndex + 1}.\n\nRecent actions:\n${actionLog}\n\nContinue with the next step.`;
        }

        // Inject incoming messages from other tasks
        turnText += this.drainInbox();

        const turnMessage: VisionMessage = {
          role: "user",
          content: [{ type: "input_text", text: turnText }],
        };

        if (history.length > 20) {
          history.splice(1, history.length - 19);
        }
        history.push(turnMessage);

        this.pushStatus("Thinking...");
        const { text: rawResponse, usage } = await this.callVisionModel(
          systemPrompt,
          history,
        );
        if (usage) this.addUsage(usage);
        console.log(
          `[code-loop] raw (${rawResponse.length}c):`,
          rawResponse.slice(0, 400),
        );
        const { thought, action } = parseModelResponse(rawResponse);

        history.push({
          role: "assistant",
          content: [{ type: "output_text", text: rawResponse }],
        });

        const step: TaskStep = {
          index: this.task.steps.length,
          timestamp: Date.now(),
          screenshotBase64: "",
          action,
          thought,
        };

        if (action.type === "done") {
          this.task.summary = action.summary;
          this.task.steps.push(step);
          this.pushUpdate();
          return this.finish("completed");
        }

        if (action.type === "fail") {
          this.task.steps.push(step);
          this.pushUpdate();
          return this.finish("failed", action.reason);
        }

        // In code mode, only allow non-visual actions
        if (["click", "double_click", "scroll", "move"].includes(action.type)) {
          step.error = `Action "${action.type}" not available in code mode. Use shell commands instead.`;
          this.task.steps.push(step);
          this.pushUpdate();
          await this.sleep(200);
          continue;
        }

        // Execute action (shell, polymarket, web_scrape, etc.)
        try {
          const result = await this.executeCodeAction(action);
          if (result) step.result = result;
        } catch (e) {
          step.error = e instanceof Error ? e.message : String(e);
        }

        this.task.steps.push(step);
        this.pushUpdate();

        // Every 3 app_script steps, capture a canvas preview for visual feedback
        if (
          action.type === "app_script" &&
          this.task.capabilities.includes("app.scripting") &&
          this.task.steps.filter((s) => s.action.type === "app_script").length %
            3 ===
            0
        ) {
          try {
            const appName = (action as any).app as string;
            const previewB64 = await this.appBridge.getPreview(appName as any);
            if (previewB64) {
              history.push({
                role: "user",
                content: [
                  {
                    type: "input_text",
                    text: "[CANVAS PREVIEW] Look at the current state of your design. Check composition, alignment, spacing, and visual balance before continuing.",
                  },
                  {
                    type: "input_image",
                    image_url: `data:image/png;base64,${previewB64}`,
                  },
                ],
              });
            }
          } catch {
            // Preview failed — continue without it
          }
        }

        await this.sleep(200);
      } catch (e) {
        if (this.aborted) break;
        return this.finish(
          "failed",
          `Code loop error: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    if (this.aborted) return this.finish("cancelled");
    return this.finish("failed", `Reached max steps (${this.task.maxSteps})`);
  }

  /** Execute an action in code mode (no bridge needed). */
  private async executeCodeAction(
    action: TaskAction,
  ): Promise<string | undefined> {
    switch (action.type) {
      case "shell":
        return this.executeShell(action.command, action.cwd, action.timeout);
      case "wait":
        await this.sleep(action.ms);
        return undefined;
      case "web_scrape": {
        const data = await scrapeUrl(action.url, action.instruction);
        if (data.includes("\t"))
          this.lastScrapeData += (this.lastScrapeData ? "\n" : "") + data;
        return data;
      }
      case "save_to_excel": {
        if (!this.lastScrapeData)
          return "[Error: no data available. Use web_scrape first.]";
        try {
          const filePath = await createExcelFromTsv(
            this.lastScrapeData,
            action.filename,
            action.filter,
          );
          return `Excel saved: ${filePath}`;
        } catch (e) {
          return `[Error creating Excel: ${e instanceof Error ? e.message : String(e)}]`;
        }
      }
      case "launch":
        return this.executeShell(
          `powershell.exe -NoProfile -Command "Start-Process '${action.app}'"`,
        );
      case "polymarket_get_account_summary":
      case "polymarket_get_trader_leaderboard":
      case "polymarket_search_markets":
      case "polymarket_place_order":
      case "polymarket_close_position":
        return this.executePolymarketAction(action);
      case "file_read":
        return this.executeFileRead(
          action.path,
          action.offset,
          action.limit,
          action.cwd,
        );
      case "file_write":
        return this.executeFileWrite(action.path, action.content, action.cwd);
      case "file_edit":
        return this.executeFileEdit(
          action.path,
          action.old_string,
          action.new_string,
          action.cwd,
        );
      case "file_list":
        return this.executeFileList(action.pattern, action.cwd);
      case "file_search":
        return this.executeFileSearch(
          action.pattern,
          action.path,
          action.glob,
          action.cwd,
        );
      case "app_script": {
        const result = await this.appBridge.run(
          action.app as any,
          action.script,
        );
        return result.ok ? result.output : `[AppBridge error: ${result.error}]`;
      }
      case "task_list_peers":
      case "task_send":
      case "task_read":
      case "task_message":
        return this.executeInterTaskAction(action);
      case "remember_fact":
      case "forget_fact":
        return this.executeFactAction(action);
      case "set_identity":
        return this.executeSetIdentity(action);
      case "generate_image":
        return this.executeGenerateImage(action);
      default:
        return `[Action "${action.type}" not supported in code mode]`;
    }
  }

  /** Read a file with line numbers (cat -n style). */
  private async executeFileRead(
    filePath: string,
    offset?: number,
    limit?: number,
    cwd?: string,
  ): Promise<string> {
    const fs = await import("fs/promises");
    const path = await import("path");
    const resolved = cwd ? path.resolve(cwd, filePath) : path.resolve(filePath);
    try {
      const content = await fs.readFile(resolved, "utf-8");
      let lines = content.split("\n");
      const startLine = offset && offset > 0 ? offset - 1 : 0;
      if (limit && limit > 0) {
        lines = lines.slice(startLine, startLine + limit);
      } else if (startLine > 0) {
        lines = lines.slice(startLine);
      }
      const numbered = lines.map(
        (line, i) => `${String(startLine + i + 1).padStart(6)}\t${line}`,
      );
      const result = numbered.join("\n");
      return headTail(result, 8000);
    } catch (e) {
      return `[Error reading ${resolved}: ${e instanceof Error ? e.message : String(e)}]`;
    }
  }

  /** Write a file, creating intermediate dirs. */
  private async executeFileWrite(
    filePath: string,
    content: string,
    cwd?: string,
  ): Promise<string> {
    const fs = await import("fs/promises");
    const path = await import("path");
    const resolved = cwd ? path.resolve(cwd, filePath) : path.resolve(filePath);
    try {
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, content, "utf-8");
      return `File written: ${resolved} (${content.length} bytes)`;
    } catch (e) {
      return `[Error writing ${resolved}: ${e instanceof Error ? e.message : String(e)}]`;
    }
  }

  /** Search-and-replace in a file. Fails if old_string not found or not unique. */
  private async executeFileEdit(
    filePath: string,
    oldStr: string,
    newStr: string,
    cwd?: string,
  ): Promise<string> {
    const fs = await import("fs/promises");
    const path = await import("path");
    const resolved = cwd ? path.resolve(cwd, filePath) : path.resolve(filePath);
    try {
      const content = await fs.readFile(resolved, "utf-8");
      const count = content.split(oldStr).length - 1;
      if (count === 0) return `[Error: old_string not found in ${resolved}]`;
      if (count > 1)
        return `[Error: old_string found ${count} times in ${resolved} — must be unique. Add more context.]`;
      const updated = content.replace(oldStr, newStr);
      await fs.writeFile(resolved, updated, "utf-8");
      return `File edited: ${resolved} (replaced 1 occurrence)`;
    } catch (e) {
      return `[Error editing ${resolved}: ${e instanceof Error ? e.message : String(e)}]`;
    }
  }

  /** List files matching a glob pattern using fd (fallback to find). */
  private async executeFileList(
    pattern: string,
    cwd?: string,
  ): Promise<string> {
    const { exec } = require("child_process") as typeof import("child_process");
    const execOpts = {
      timeout: 10_000,
      maxBuffer: 512 * 1024,
      cwd: cwd || undefined,
    };
    return new Promise((resolve) => {
      // Try fd first, fallback to find
      const fdCmd = `fd --type f --glob '${pattern.replace(/'/g, "'\\''")}'`;
      exec(fdCmd, execOpts, (err, stdout) => {
        if (!err && stdout.trim()) {
          const result = stdout.trim();
          resolve(headTail(result, 6000));
          return;
        }
        // Fallback to find
        const findCmd = `find . -type f -name '${pattern.replace(/'/g, "'\\''")}'`;
        exec(findCmd, execOpts, (err2, stdout2) => {
          if (err2) {
            resolve(`[Error listing files: ${err2.message}]`);
            return;
          }
          const result = stdout2.trim() || "(no files found)";
          resolve(headTail(result, 6000));
        });
      });
    });
  }

  /** Search file contents using rg (fallback to grep -rn). */
  private async executeFileSearch(
    pattern: string,
    searchPath?: string,
    glob?: string,
    cwd?: string,
  ): Promise<string> {
    const { exec } = require("child_process") as typeof import("child_process");
    const execOpts = {
      timeout: 10_000,
      maxBuffer: 512 * 1024,
      cwd: cwd || undefined,
    };
    return new Promise((resolve) => {
      const escapedPattern = pattern.replace(/'/g, "'\\''");
      const dir = searchPath || ".";
      const globFlag = glob ? ` --glob '${glob.replace(/'/g, "'\\''")}'` : "";
      const rgCmd = `rg -n --max-count 50 '${escapedPattern}' ${dir}${globFlag}`;
      exec(rgCmd, execOpts, (err, stdout) => {
        if (!err || (err as any)?.code === 1) {
          const result = (stdout || "").trim() || "(no matches found)";
          resolve(headTail(result, 6000));
          return;
        }
        // Fallback to grep
        const grepGlob = glob
          ? ` --include='${glob.replace(/'/g, "'\\''")}'`
          : "";
        const grepCmd = `grep -rn '${escapedPattern}' ${dir}${grepGlob} | head -50`;
        exec(grepCmd, execOpts, (err2, stdout2) => {
          if (err2 && !(err2 as any)?.code) {
            resolve(`[Error searching: ${err2.message}]`);
            return;
          }
          const result = (stdout2 || "").trim() || "(no matches found)";
          resolve(headTail(result, 6000));
        });
      });
    });
  }

  /** Execute actions in API-only mode (no browser). Only polymarket + inter-task + wait/done/fail. */
  private async executeApiOnlyAction(
    action: TaskAction,
  ): Promise<string | undefined> {
    const type = action.type;
    switch (type) {
      case "polymarket_get_account_summary":
      case "polymarket_get_trader_leaderboard":
      case "polymarket_search_markets":
      case "polymarket_place_order":
      case "polymarket_close_position":
        return this.executePolymarketAction(action);
      case "task_list_peers":
      case "task_send":
      case "task_read":
      case "task_message":
        return this.executeInterTaskAction(action);
      case "remember_fact":
      case "forget_fact":
        return this.executeFactAction(action);
      case "set_identity":
        return this.executeSetIdentity(action);
      case "generate_image":
        return this.executeGenerateImage(action);
      case "wait":
        await this.sleep((action as any).ms ?? 1000);
        return undefined;
      default:
        return `[Error: "${type}" is not available in API-only mode. Use polymarket_* actions.]`;
    }
  }

  /**
   * Route vision call to the correct provider.
   */
  private async callVisionModel(
    systemPrompt: string,
    messages: VisionMessage[],
  ): Promise<{
    text: string;
    usage?: { inputTokens: number; outputTokens: number };
  }> {
    switch (this.opts.provider) {
      case "chatgpt":
        return {
          text: await codexVisionRespond({
            systemPrompt,
            messages,
            sessionId: this.task.id,
            model: this.opts.openaiModel,
          }),
        };
      case "claude": {
        const { claudeVisionRespond } =
          await import("../providers/claude-vision");
        return { text: await claudeVisionRespond({ systemPrompt, messages }) };
      }
      case "deepseek": {
        const { deepseekVisionRespond } =
          await import("../providers/deepseek-vision");
        return {
          text: await deepseekVisionRespond({ systemPrompt, messages }),
        };
      }
      case "kimi": {
        const { kimiVisionRespond } = await import("../providers/kimi-vision");
        return kimiVisionRespond({ systemPrompt, messages });
      }
      case "glm": {
        const { glmVisionRespond } = await import("../providers/glm-vision");
        return glmVisionRespond({ systemPrompt, messages });
      }
      case "minimax": {
        const { minimaxVisionRespond } =
          await import("../providers/minimax-vision");
        return minimaxVisionRespond({ systemPrompt, messages });
      }
      case "openrouter": {
        const { openrouterVisionRespond } =
          await import("../providers/openrouter-vision");
        return openrouterVisionRespond({ systemPrompt, messages });
      }
      case "gemini": {
        const { geminiVisionRespond } =
          await import("../providers/gemini-vision");
        return geminiVisionRespond({ systemPrompt, messages });
      }
      case "ollama": {
        const { ollamaVisionRespond } =
          await import("../providers/ollama-vision");
        return ollamaVisionRespond({ systemPrompt, messages });
      }
      default:
        throw new Error(`Unsupported provider: ${this.opts.provider}`);
    }
  }

  private addUsage(usage: { inputTokens: number; outputTokens: number }): void {
    if (!this.usageTotals)
      this.usageTotals = { inputTokens: 0, outputTokens: 0 };
    this.usageTotals.inputTokens += usage.inputTokens;
    this.usageTotals.outputTokens += usage.outputTokens;
    this.task.usage = { ...this.usageTotals };
  }

  /**
   * Cancel the task immediately.
   */
  abort(reason?: string): void {
    this.aborted = true;
    if (reason) {
      this.task.error = reason;
    }
    this.cleanup();
  }

  /** Handle set_identity — sub-agent chooses its own name. */
  /** Saves data URL attachments to /tmp/ files. Returns { filePaths, dataUrls }. */
  private async resolveAttachments(): Promise<{
    filePaths: string[];
    dataUrls: string[];
  }> {
    const all = (this.task.attachments ?? []).filter(
      (x) => typeof x === "string",
    );
    const filePaths: string[] = [];
    const dataUrls: string[] = [];
    for (const a of all) {
      if (a.startsWith("data:image/")) {
        dataUrls.push(a);
        const ext = a.startsWith("data:image/png") ? "png" : "jpg";
        const p = `${os.tmpdir()}/skynul-ref-${Date.now()}-${dataUrls.length}.${ext}`;
        const base64 = a.split(",")[1];
        await writeFile(p, Buffer.from(base64, "base64"));
        filePaths.push(p);
      } else {
        filePaths.push(a);
      }
    }
    return { filePaths, dataUrls };
  }

  private async executeGenerateImage(action: TaskAction): Promise<string> {
    const raw = action as Record<string, unknown>;
    const prompt = String(raw.prompt ?? "");
    if (!prompt) return "generate_image requires a prompt";
    const size =
      (raw.size as "1024x1024" | "1792x1024" | "1024x1792") ?? "1024x1024";
    const filePath = await generateImage(prompt, size);
    if (!this.task.attachments) this.task.attachments = [];
    this.task.attachments.push(filePath);
    this.pushUpdate();
    return `Image generated and saved to: ${filePath}`;
  }

  private executeSetIdentity(action: TaskAction): string {
    const raw = action as Record<string, unknown>;
    if (raw.name && typeof raw.name === "string") {
      this.task.agentName = raw.name;
    }
    if (raw.role && typeof raw.role === "string") {
      this.task.agentRole = raw.role as string;
    }
    this.pushUpdate();
    return `Identity: ${this.task.agentName ?? ""}${this.task.agentRole ? ` (${this.task.agentRole})` : ""}`;
  }

  /** Handle inter-task communication actions. */
  private async executeInterTaskAction(action: TaskAction): Promise<string> {
    const tm = this.opts.taskManager;
    if (!tm)
      return "[Error: task manager not available for inter-task communication]";

    switch (action.type) {
      case "task_list_peers": {
        const all = tm.list();
        const peers = all
          .filter((t) => t.id !== this.opts.taskId)
          .map((t) => ({
            id: t.id,
            prompt: t.prompt.slice(0, 120),
            status: t.status,
          }));
        return JSON.stringify(peers);
      }
      case "task_send": {
        const result = await tm.spawnAndWait(
          action.prompt,
          this.task.capabilities,
          this.task.id,
          {
            agentName: action.agentName,
            agentRole: action.agentRole,
          },
        );
        return `Sub-task ${result.taskId} ${result.status}: ${result.output}`;
      }
      case "task_read": {
        const target = tm.get(action.taskId);
        if (!target) return `[Error: task ${action.taskId} not found]`;
        return JSON.stringify({
          id: target.id,
          status: target.status,
          summary: target.summary ?? null,
        });
      }
      case "task_message": {
        try {
          tm.sendMessage(
            action.taskId,
            this.opts.taskId ?? this.task.id,
            action.message,
          );
          return `Message sent to ${action.taskId}`;
        } catch (e) {
          return `[Error: ${e instanceof Error ? e.message : String(e)}]`;
        }
      }
      default:
        return "[Error: unknown inter-task action]";
    }
  }

  /** Handle remember/forget fact actions. */
  private executeFactAction(action: TaskAction): string {
    if (action.type === "remember_fact") {
      if (!action.fact || typeof action.fact !== "string")
        return '[Error: "fact" string required]';
      saveFact(action.fact);
      return `Remembered: "${action.fact}"`;
    }
    if (action.type === "forget_fact") {
      if (typeof action.factId !== "number")
        return '[Error: "factId" number required]';
      deleteFact(action.factId);
      return `Forgot fact #${action.factId}`;
    }
    return "[Error: unknown fact action]";
  }

  private executeShell(
    command: string,
    cwd?: string,
    timeoutMs?: number,
  ): Promise<string> {
    return new Promise((resolve) => {
      const { exec } =
        require("child_process") as typeof import("child_process");
      const timeout = Math.min(timeoutMs ?? 120_000, 300_000); // default 120s, max 5min
      const child = exec(
        command,
        { timeout, maxBuffer: 1024 * 1024, cwd: cwd || undefined },
        (err, stdout, stderr) => {
          const out = headTail((stdout ?? "").toString(), 4000);
          const errOut = (stderr ?? "").toString().slice(0, 1000);
          if (err) {
            resolve(
              `[Exit ${err.code ?? 1}] ${errOut || err.message}\n${out}`.trim(),
            );
          } else {
            resolve(
              errOut ? `${out}\n[stderr] ${errOut}` : out || "(no output)",
            );
          }
        },
      );
      child.stdin?.end();
    });
  }

  private async executePolymarketAction(action: TaskAction): Promise<string> {
    const client = new PolymarketClient({ mode: "live" });

    switch (action.type) {
      case "polymarket_get_account_summary": {
        const summary = await client.getAccountSummary();
        const result =
          `Balance: $${summary.balanceUsd.toFixed(2)}, ${summary.positions.length} positions.` +
          (summary.positions.length > 0
            ? "\n" +
              summary.positions
                .map(
                  (p) =>
                    `  ${p.marketTitle} [${p.outcome}] ${p.sizeShares} shares @ $${p.avgPriceUsd.toFixed(2)}, PnL $${p.pnlUsd.toFixed(2)}`,
                )
                .join("\n")
            : "");
        this.task.summary = `Polymarket: ${result}`;
        return result;
      }
      case "polymarket_get_trader_leaderboard": {
        const traders = await client.getTopTraders({
          limit: 10,
          timePeriod: "MONTH",
          category: "OVERALL",
        });
        const top = traders
          .slice(0, 5)
          .map(
            (t) =>
              `#${t.rank} ${t.userName || t.wallet.slice(0, 8)} PnL $${t.pnlUsd.toFixed(2)}`,
          )
          .join("; ");
        const result = `Leaderboard (MONTH): ${top || "no traders found"}.`;
        this.task.summary = `Polymarket ${result}`;
        return result;
      }
      case "polymarket_search_markets": {
        const raw = action as any;
        const markets = await client.searchMarkets(raw.query, raw.limit ?? 5);
        if (markets.length === 0) return "No markets found.";
        const result = markets
          .map((m) => {
            const tokens = m.tokens
              .map((t) => `${t.outcome}: ${t.tokenId} @ $${t.price.toFixed(3)}`)
              .join(", ");
            return `${m.title} | vol: $${m.volume.toFixed(0)} | tokens: [${tokens}]`;
          })
          .join("\n");
        return result;
      }
      case "polymarket_place_order": {
        await client.placeOrder({
          tokenId: action.tokenId,
          side: action.side,
          price: action.price,
          size: action.size,
          tickSize: action.tickSize,
          negRisk: action.negRisk,
        });
        return `Order placed (GTC): ${action.side} ${action.size} @ $${action.price} on ${action.tokenId.slice(0, 10)}... — order stays in book until filled.`;
      }
      case "polymarket_close_position": {
        if (!action.tokenId)
          return "[Error: tokenId is required. Use polymarket_get_account_summary to find your position tokenId first.]";
        await client.closePosition({
          tokenId: action.tokenId,
          size: action.size,
        });
        return `Position closed: ${action.tokenId.slice(0, 10)}... size=${action.size ?? "full"}`;
      }
      default:
        return "";
    }
  }

  private finish(
    status: "completed" | "failed" | "cancelled",
    error?: string,
  ): Task {
    this.cleanup();
    this.task.status = status;
    if (error) this.task.error = error;
    this.task.updatedAt = Date.now();
    this.pushUpdate();
    return this.task;
  }

  private cleanup(): void {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }

  private pushUpdate(): void {
    this.task.updatedAt = Date.now();
    this.callbacks.onUpdate({ ...this.task });
  }

  /** Push a status message visible in the UI (stored in task.error temporarily while running). */
  private pushStatus(msg: string): void {
    this.task.summary = msg;
    this.pushUpdate();
  }

  /** Drain inbox and return a text block to prepend to turnText, or empty string if no messages. */
  private drainInbox(): string {
    const tm = this.opts.taskManager;
    if (!tm) return "";
    const msgs = tm.drainMessages(this.opts.taskId ?? this.task.id);
    if (msgs.length === 0) return "";
    const lines = msgs.map((m) => `  From ${m.from}: ${m.message}`).join("\n");
    return `\n\n[INCOMING MESSAGES]\n${lines}\n[/INCOMING MESSAGES]`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getTask(): Task {
    return { ...this.task };
  }

  /**
   * Get a user-friendly display name for the provider.
   * Capitalizes the provider ID (e.g., 'kimi' -> 'Kimi', 'claude' -> 'Claude')
   */
  private getProviderDisplayName(): string {
    const provider = this.opts.provider;
    return provider.charAt(0).toUpperCase() + provider.slice(1);
  }
}
