# Labelled policy fixtures

Each directory holds a policy and the clauses a good extraction should find
(docs/05 evals).

```
<site>/policy.md     the policy text, as the extraction stage would see it
<site>/labels.json   expected clauses: category + a distinctive substring
```

`labels.json` records a **substring**, not a full quote. The point is to check
that a model found the right clause, not that it chose the same sentence
boundaries — two models can both be right and quote different amounts.

These are written, not scraped. A real site's terms are that site's copyright,
and a fixture that changes when the site does is not a fixture. They are written
to contain the shapes that matter: a perpetual content licence, a class-action
waiver, data sharing, auto-renewal, unilateral changes — alongside ordinary
boilerplate that should *not* be flagged as concerning, because a model that
flags everything is as useless as one that flags nothing.
