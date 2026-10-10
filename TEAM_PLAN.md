# NeuroAccess team plan

## Product direction

Keep the existing MRI research workstation as the base. Extend it for Tech for Equity by reducing interface and information barriers for people with different accessibility needs and levels of digital literacy. Keep all explanations educational and clearly non-diagnostic.

## Six-hour build plan

Choose one owner per area and agree on a single integration point early. Adjust roles to match team size.

| Owner | Focus | Hackathon deliverable |
| --- | --- | --- |
| Teammate 1 — UI/accessibility | Add a plain-language mode, clear labels, keyboard focus states, and improved contrast or text sizing. | A short end-to-end accessible flow through the scan workspace. |
| Teammate 2 — backend/model | Confirm which demo predictions come from loaded weights versus fallback behavior; expose honest model status and uncertainty. | A status panel that never presents a fallback as a real prediction. |
| Teammate 3 — equity/education | Draft an educational explainer and “questions to ask your care team” panel using fictional examples and plain language. | One complete, reviewed example in the app. |
| Teammate 4 — integration/presentation | Integrate changes, collect source and dataset attribution, prepare a short demo, and keep the pitch within five minutes. | A working demo path, attribution, and presentation. |

For a smaller team, combine roles 2 and 3, or make role 4 a shared responsibility.

## Suggested timeboxes

1. **First 30 minutes:** Run the existing app, inspect the fallback and model status, agree on one user story, and split ownership.
2. **Next 3 hours:** Build the small features above in parallel; avoid adding model training to the critical path.
3. **Next 90 minutes:** Integrate, check the demo flow, and remove or label any unverified claims.
4. **Final 60 minutes:** Practice the five-minute presentation, confirm every teammate has a speaking part, and prepare a backup screen recording or screenshots.

## Demo story

Show how a user can navigate the research workspace, understand what the prototype is and is not saying, and use the accessible explanation or question prompts. Explain that the classifier is an inherited research baseline and present the team's new work as the accessibility extension. Do not frame predictions as diagnoses or promise clinical impact.

## Future work

Evaluate the interface with people with disabilities and varied health/digital literacy; validate translations with qualified reviewers; audit dataset provenance and model limitations; and only pursue clinical use through appropriate medical, privacy, and regulatory review.
