# Fixture site

A deliberately misconfigured page for exercising the extension in a real
browser. Auditing it should never mean pointing the tool at somebody else's
site.

Serve it, then audit `http://localhost:8787/` from the side panel:

```
pnpm serve-fixture
```

## What it is built to trigger

| Expected `ruleId`                          | Why it fires                                    |
| ------------------------------------------ | ----------------------------------------------- |
| `transport/insecure-protocol`               | served over plain HTTP                          |
| `forms/login-form-insecure-action`          | password field posting to `http:`               |
| `forms/cross-origin-form-action`            | the action is on another origin                 |
| `forms/password-form-autocomplete-off`      | `autocomplete="off"` on a password form         |
| `scripts/third-party-script-without-sri`    | jsDelivr script with no `integrity`             |
| `policy-presence/no-privacy-policy-link`    | no privacy link                                 |
| `policy-presence/no-terms-link`             | no terms link                                   |

Cookie rules do not fire here: the page sets none. To exercise those, add a
`Set-Cookie` header in front of it or visit a site that sets cookies.

Auditing this file through the CLI instead of the browser adds one more finding,
`cookies/cookie-flags-unknown`, because only the extension's background worker
can read cookie flags. Seeing it in the side panel would mean the worker failed
to enrich the snapshot.

`transport/mixed-content` does not fire either — the page is HTTP, so an HTTP
subresource is not mixed content. That is the rule behaving correctly, not a
gap.
