import { z } from "zod";

export const LAYA_CHECKPOINTS = ["english", "multilingual", "typed-decisions"] as const;
const layaCheckpointSchema = z.enum(LAYA_CHECKPOINTS);

export const isLayaCheckpoint = (model: string): boolean => layaCheckpointSchema.safeParse(model).success;

const jevClassifierConfigFields = {
  provider: z.enum(["jev", "laya"]).optional(),
  model: z.string().trim().optional(),
  timeout_ms: z.number().int().positive().default(3000),
  instructions: z
    .string()
    .nullish()
    .transform((value) => value ?? undefined),
  circuit_breaker_enabled: z.boolean().optional(),
  circuit_breaker_cooldown_seconds: z.number().finite().positive().optional(),
};

const validateDecisionModel = (config: { provider?: string; model?: string }, context: z.RefinementCtx) => {
  if (config.provider === "laya" && !layaCheckpointSchema.safeParse(config.model).success) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["model"], message: "Choose a supported Laya checkpoint" });
  } else if (config.model === "") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["model"], message: "Enter a model" });
  }
};

const withModelDefault = <T extends { provider?: string; model?: string }>(config: T) => ({
  ...config,
  model: config.model ?? (config.provider === "laya" ? "" : "jev-latest"),
});

const storedJevClassifierConfigFields = {
  ...jevClassifierConfigFields,
  provider: z.preprocess((value) => (value === "typesafe" ? "jev" : value), z.enum(["jev", "laya"]).default("jev")),
};

export const storedJevClassifierConfigSchema = z.object(storedJevClassifierConfigFields).transform(withModelDefault);

export const jevClassifierConfigSchema = z
  .object(jevClassifierConfigFields)
  .superRefine(validateDecisionModel)
  .transform(withModelDefault);

const jevClassifierFormConfigFields = {
  ...jevClassifierConfigFields,
  api_base: z.string().trim().nullish(),
  api_key: z.string().trim().nullish(),
  connection_reset: z.object({ api_base: z.literal(true).optional(), api_key: z.literal(true).optional() }).optional(),
};

export const jevClassifierFormConfigSchema = z
  .object(jevClassifierFormConfigFields)
  .superRefine(validateDecisionModel)
  .transform(withModelDefault);

export type JevClassifierConfig = z.infer<typeof jevClassifierFormConfigSchema>;
export type DecisionModelProvider = NonNullable<JevClassifierConfig["provider"]>;

export const defaultJevClassifierConfig = (): JevClassifierConfig =>
  jevClassifierConfigSchema.parse({ provider: "jev" });

export interface StoredOpenSourceClassifierFields {
  opensource_classifier_config?: unknown;
  jev_classifier_config?: unknown;
}

export const readStoredOpenSourceClassifierConfig = (
  input: StoredOpenSourceClassifierFields,
): { config?: JevClassifierConfig; error?: string } => {
  if ("opensource_classifier_config" in input && "jev_classifier_config" in input) {
    return {
      error:
        "This router has both OSS and legacy Jev configuration. Remove one configuration through the API before editing",
    };
  }
  const result = storedJevClassifierConfigSchema.safeParse(
    input.opensource_classifier_config ?? input.jev_classifier_config ?? {},
  );
  return result.success
    ? { config: result.data }
    : {
        error:
          "The saved OSS classifier configuration is invalid. Correct its provider and settings through the API before editing",
      };
};

export const transitionDecisionModelProvider = (
  config: JevClassifierConfig,
  provider: DecisionModelProvider,
): JevClassifierConfig => {
  if ((config.provider ?? "jev") === provider) return config;
  const { api_base, api_key, connection_reset, ...settings } = config;
  return { ...settings, provider, model: provider === "laya" ? "english" : "jev-latest" };
};

const normalizeConnectionValue = (value: string | null | undefined, reset: boolean | undefined) =>
  value?.trim() || (value === null || reset ? null : undefined);

export const normalizeJevClassifierConfig = (
  config: JevClassifierConfig = defaultJevClassifierConfig(),
): Omit<JevClassifierConfig, "connection_reset"> => {
  const apiBase = normalizeConnectionValue(config.api_base, config.connection_reset?.api_base);
  const apiKey = normalizeConnectionValue(config.api_key, config.connection_reset?.api_key);
  return {
    provider: config.provider ?? "jev",
    model: config.model.trim(),
    timeout_ms: config.timeout_ms,
    ...(apiBase !== undefined && { api_base: apiBase }),
    ...(apiKey !== undefined && { api_key: apiKey }),
    ...(config.instructions?.trim() && { instructions: config.instructions.trim() }),
    ...(config.circuit_breaker_enabled !== undefined && { circuit_breaker_enabled: config.circuit_breaker_enabled }),
    ...(config.circuit_breaker_cooldown_seconds !== undefined && {
      circuit_breaker_cooldown_seconds: config.circuit_breaker_cooldown_seconds,
    }),
  };
};
