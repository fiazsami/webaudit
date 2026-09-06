import { createFinding, type Finding } from "../../findings/schema.js";
import type { FormRef, PageSnapshot } from "../../snapshot/schema.js";
import { isSameOrigin } from "../../snapshot/url.js";
import type { Analyzer } from "../types.js";

const ANALYZER_ID = "forms";

/**
 * Where the page sends what the user types (docs/03).
 *
 * This analyzer owns every form rule, including insecure actions, which the
 * original table split between here and `transport`. Splitting them meant the
 * same form was reported twice.
 */
export const formsAnalyzer: Analyzer = {
  id: ANALYZER_ID,
  needs: [],

  run(snapshot: PageSnapshot): Promise<Finding[]> {
    const findings: Finding[] = [];

    const insecureLogin = snapshot.forms.filter(
      (form) => form.hasPasswordField && isInsecureAction(form),
    );
    const insecureOther = snapshot.forms.filter(
      (form) => !form.hasPasswordField && isInsecureAction(form),
    );
    const loginOnHttpPage = snapshot.forms.filter(
      (form) =>
        form.hasPasswordField &&
        snapshot.protocol === "http:" &&
        !isInsecureAction(form),
    );
    const crossOrigin = snapshot.forms.filter(
      (form) => !isSameOrigin(form.action, snapshot.url),
    );
    const autocompleteOff = snapshot.forms.filter(
      (form) => form.hasPasswordField && form.autocompleteOff,
    );

    if (insecureLogin.length > 0) {
      findings.push(
        createFinding({
          analyzerId: ANALYZER_ID,
          ruleId: "login-form-insecure-action",
          severity: "critical",
          confidence: "high",
          title: "Password submitted over HTTP",
          summary:
            "A form containing a password field submits over an unencrypted " +
            "connection. The password is readable by anyone on the network path.",
          evidence: evidenceFor(insecureLogin),
          references: [
            "https://developer.mozilla.org/en-US/docs/Web/Security/Insecure_passwords",
          ],
          tags: ["forms", "transport"],
        }),
      );
    }

    if (insecureOther.length > 0) {
      findings.push(
        createFinding({
          analyzerId: ANALYZER_ID,
          ruleId: "form-insecure-action",
          severity: "medium",
          confidence: "high",
          title: "Form submits over HTTP",
          summary:
            "Whatever is typed into this form is sent unencrypted, and the " +
            "response can be modified in transit.",
          evidence: evidenceFor(insecureOther),
          tags: ["forms", "transport"],
        }),
      );
    }

    if (loginOnHttpPage.length > 0) {
      findings.push(
        createFinding({
          analyzerId: ANALYZER_ID,
          ruleId: "login-form-on-insecure-page",
          severity: "high",
          confidence: "high",
          title: "Login form delivered over HTTP",
          summary:
            "The form posts to HTTPS, but the page carrying it arrived over " +
            "HTTP — so an attacker on the network could have rewritten where it " +
            "posts before the user ever typed anything.",
          evidence: evidenceFor(loginOnHttpPage),
          tags: ["forms", "transport"],
        }),
      );
    }

    if (crossOrigin.length > 0) {
      const hasPassword = crossOrigin.some((form) => form.hasPasswordField);
      findings.push(
        createFinding({
          analyzerId: ANALYZER_ID,
          ruleId: "cross-origin-form-action",
          severity: hasPassword ? "medium" : "low",
          confidence: "medium",
          title: "Form submits to another origin",
          summary:
            "This form sends its contents to a different origin than the page " +
            "it appears on. That is normal for federated login and payment " +
            "providers, and it is also what a credential-stealing injection " +
            "looks like. Worth confirming the destination is expected.",
          evidence: evidenceFor(crossOrigin),
          tags: ["forms"],
        }),
      );
    }

    if (autocompleteOff.length > 0) {
      findings.push(
        createFinding({
          analyzerId: ANALYZER_ID,
          ruleId: "password-form-autocomplete-off",
          severity: "low",
          confidence: "medium",
          title: "Password form disables autocomplete",
          summary:
            "Turning autocomplete off on a password form blocks password " +
            "managers, which pushes people toward weaker, reused passwords. " +
            "Browsers largely ignore it now, so it mostly signals intent.",
          evidence: evidenceFor(autocompleteOff),
          references: [
            "https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/autocomplete",
          ],
          tags: ["forms", "usability"],
        }),
      );
    }

    return Promise.resolve(findings);
  },
};

function isInsecureAction(form: FormRef): boolean {
  return form.action.startsWith("http:");
}

function evidenceFor(forms: readonly FormRef[]): Finding["evidence"] {
  return forms.map((form) => ({
    kind: "form" as const,
    value: `${form.method} ${form.action}`,
    location: form.fieldTypes.join(", "),
  }));
}
