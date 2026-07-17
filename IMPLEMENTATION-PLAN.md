# Implementation plan — Standard-Onboarding-V2

## Objective
Create a working prototype that mirrors the structure of the reference experience:
1. Welcome
2. Goal selection
3. Spend and preference capture
4. Ranked recommendations
5. Compare view
6. End state with a selected card

## Scope
This first version is a polished static prototype focused on flow, content hierarchy, and a convincing end-to-end interaction, not a production-ready onboarding engine.

## Deliverables
- A single-page prototype in app.html
- A local repo folder named Standard-Onboarding-V2
- A short README with run instructions
- A clear implementation plan for future expansion

## Proposed build steps
1. Create the repo folder and initial structure
   - app.html
   - README.md
   - IMPLEMENTATION-PLAN.md

2. Build the core flow UI
   - Welcome hero screen
   - Goal choice cards
   - Spend and fee selectors
   - Recommendation cards
   - Compare panel
   - Selected-card end state

3. Add interactive state handling
   - Track selected goals and categories
   - Score cards dynamically from the user selections
   - Support moving forward and backward through screens
   - Highlight the final selected card

4. Polish the visual language
   - Use a warm, calm, premium UI akin to the reference
   - Keep spacing and hierarchy clean and readable
   - Make the card previews feel product-like and polished

5. Verify locally
   - Open the page in a browser
   - Confirm each step transitions correctly
   - Check that card ranking and selection state behave as expected

## Content assumptions
- The prototype uses a small set of representative cards rather than a full production dataset.
- The ranking logic is intentionally lightweight and should be replaced with a richer decision engine later.
- The flow is focused on the discovery-to-selection experience and not the later identity-verification steps.

## Recommended next steps
- Replace the placeholder card data with CRM or product-team-approved copy.
- Add real assets or 3D card previews if the design team wants a more immersive card visual.
- Hook the flow into a real frontend framework if it needs to become a reusable product shell.

## Open questions
No blockers at the moment. The only optional decision is whether to keep this as a lightweight static prototype or expand it into a React/Vite app for easier future iteration.
