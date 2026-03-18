# Deployment Control Log

## Timestamp
- Audit window: **Thursday, March 5, 2026 (PT)**
- Canonical check completed at: **2026-03-05T06:50:00Z**

## Canonical Production Deployment
- Deployment URL: `https://usagummies-storefront-j5zfm1ody-ben-3889s-projects.vercel.app`
- Deployment ID: `dpl_EGafcWRUoVZsqTnNJUAEz9JBj9uY`
- Target: `production`
- Status: `Ready`

## Production Hostname Resolution
- `www.usagummies.com` -> `dpl_EGafcWRUoVZsqTnNJUAEz9JBj9uY` (verified via `vercel inspect`)
- `usagummies.com` -> `dpl_EGafcWRUoVZsqTnNJUAEz9JBj9uY` (verified via `vercel inspect`)
- `usagummies-storefront.vercel.app` -> `dpl_EGafcWRUoVZsqTnNJUAEz9JBj9uY` (verified and rebound)
- `usagummies-storefront-git-main-ben-3889s-projects.vercel.app` -> `dpl_EGafcWRUoVZsqTnNJUAEz9JBj9uY` (verified and rebound)

## Alias Normalization Actions
- Rebound to canonical deployment:
  - `usagummies-storefront.vercel.app`
  - `usagummies-storefront-git-main-ben-3889s-projects.vercel.app`
  - `usagummies-storefront-ben-3889s-projects.vercel.app`
- Removed drift alias:
  - `usagummies-storefront-ben-3889-ben-3889s-projects.vercel.app`

## Access Constraint
- Attempt to rebind `www.usagummies.com` and `usagummies.com` via CLI returned:
  - `You don't have access to the domain ... under ben-3889s-projects`
- Risk: custom domain write access is delegated; read verification succeeded but write operation is permission-blocked.

## Release Gate (Implemented)
- Added `npm run verify:production-smoke`.
- Added `npm run release:gate`.
- Gate order:
  1. `npm run lint`
  2. `npm run build`
  3. `npm run verify:production-smoke`

## Rollback Handle
- Previous known-good deployment retained and directly addressable:
  - `https://usagummies-storefront-j5zfm1ody-ben-3889s-projects.vercel.app`
