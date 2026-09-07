import { z } from "zod";

/**
 * What the model is allowed to return when explaining a finding (docs/03).
 *
 * Deliberately narrow. `explanation` is the only field a model ever writes into
 * a `Finding`, and constraining the response to a fixed shape is what stops
 * page-controlled text from arriving as anything other than a bounded string
 * (docs/12 T1). There is no field here that could redirect the audit.
 */
export const ExplanationSchema = z.object({
  /** Plain language, for someone who is not a security engineer. */
  explanation: z.string().min(1).max(700),
  /** What a reader could actually do about it. Empty when there is nothing. */
  suggestedAction: z.string().max(300).default(""),
});
export type Explanation = z.infer<typeof ExplanationSchema>;
