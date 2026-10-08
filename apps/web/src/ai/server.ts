import { createAiLayerFromEnv, type AiLayer } from "@jobhub/ai";

let instance: AiLayer | undefined;

/** The app's AI layer (ADR-0007), configured from the environment on first use. */
export function getAi(): AiLayer {
  instance ??= createAiLayerFromEnv(process.env);
  return instance;
}
