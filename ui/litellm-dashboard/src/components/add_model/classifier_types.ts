export type ClassifierType =
  | "heuristic"
  | "heuristic_v2"
  | "llm"
  | "oss_classifier"
  | "heuristic_first"
  | "hybrid"
  | "capability"
  | "llm_v2"
  | "custom";

export const usesLlmClassifier = (classifierType: ClassifierType): boolean =>
  (["llm", "heuristic_first", "hybrid", "capability", "llm_v2"] as const).some((type) => type === classifierType);

export const usesClassifierContext = (classifierType: ClassifierType): boolean =>
  classifierType === "oss_classifier" || usesLlmClassifier(classifierType);

export const hydrateClassifierType = (classifierType: ClassifierType | "jev" | undefined): ClassifierType =>
  classifierType === "jev" ? "oss_classifier" : classifierType ?? "heuristic";
