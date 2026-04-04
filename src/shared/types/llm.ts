export type VisionContentPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string; detail?: 'auto' | 'low' | 'high' }
  | { type: 'output_text'; text: string };

export type VisionMessage = {
  role: 'user' | 'assistant';
  content: VisionContentPart[];
};
