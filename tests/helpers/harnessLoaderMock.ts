/** Shared stub for run-loop tests that mock `@main/harness/harnessLoader`. */

export const STUB_HARNESS_PROMPT = '<system_instructions>stub</system_instructions>';

export function createHarnessLoaderMock() {
  return {
    buildOrchestratorSystemPrompt: () => STUB_HARNESS_PROMPT,
    buildOrchestratorSystemPromptForRun: async () => STUB_HARNESS_PROMPT
  };
}
