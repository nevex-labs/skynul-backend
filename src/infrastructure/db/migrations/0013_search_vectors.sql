CREATE INDEX "observations_search_vector_idx" ON "observations" USING gin (to_tsvector('english', "search_vector"));
CREATE INDEX "task_logs_search_vector_idx" ON "task_logs" USING gin (to_tsvector('english', "search_vector"));
CREATE INDEX "user_facts_search_vector_idx" ON "user_facts" USING gin (to_tsvector('english', "search_vector"));
CREATE INDEX "user_learnings_search_vector_idx" ON "user_learnings" USING gin (to_tsvector('english', "search_vector"));
