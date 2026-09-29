import { AutoRouterRoutingTestRequest } from "../networking";
import { ComplexityRouterConfigPayload } from "./build_complexity_router_config";
import { z } from "zod";
import { jevClassifierConfigSchema, readStoredOpenSourceClassifierConfig } from "./jev_classifier_config";

export const JEV_CONNECTION_TEST_PROMPT = "What is 2 plus 2?";

const savedClassifierRequestFields = {
  classifier_type: z.enum(["oss_classifier", "jev"]),
  tiers: z.record(z.unknown()),
  opensource_classifier_config: z.unknown().optional(),
  jev_classifier_config: z.unknown().optional(),
};

export const buildSavedJevConnectionTestRequest = (
  rawConfig: unknown,
  savedModelId?: string,
  teamId?: string,
): AutoRouterRoutingTestRequest | undefined => {
  if (!savedModelId) return undefined;
  const parsed: unknown =
    typeof rawConfig === "string"
      ? (() => {
          try {
            return JSON.parse(rawConfig) as unknown;
          } catch {
            return undefined;
          }
        })()
      : rawConfig;
  const result = z.object(savedClassifierRequestFields).passthrough().safeParse(parsed);
  if (!result.success) return undefined;
  const stored = readStoredOpenSourceClassifierConfig(result.data);
  if (stored.error) return undefined;
  const config = jevClassifierConfigSchema.safeParse(stored.config);
  if (!config.success) return undefined;
  const { jev_classifier_config, opensource_classifier_config, ...settings } = result.data;
  return {
    prompt: JEV_CONNECTION_TEST_PROMPT,
    complexity_router_config: {
      ...settings,
      classifier_type: "oss_classifier",
      opensource_classifier_config: config.data,
    },
    saved_model_id: savedModelId,
    ...(teamId && { team_id: teamId }),
  };
};

export interface BuildAutoRouterRoutingTestRequestParams {
  prompt: string;
  config: ComplexityRouterConfigPayload;
  defaultModel: string | undefined;
  routerName: string | undefined;
  teamId: string | undefined;
}

export const buildAutoRouterRoutingTestRequest = ({
  prompt,
  config,
  defaultModel,
  routerName,
  teamId,
}: BuildAutoRouterRoutingTestRequestParams): AutoRouterRoutingTestRequest => ({
  prompt,
  complexity_router_config: config,
  ...(defaultModel ? { default_model: defaultModel } : {}),
  ...(routerName?.trim() ? { router_name: routerName.trim() } : {}),
  ...(teamId ? { team_id: teamId } : {}),
});
