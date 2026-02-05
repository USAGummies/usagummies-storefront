# GA4 Exploration Template — Checkout Method

## Purpose
Track which checkout option users choose (Shop Pay, Apple Pay, Google Pay, Secure) and how those choices affect conversion.

## Prerequisite: Custom Dimension
Create an event-scoped custom dimension for `checkout_method`.

1. GA4 → Admin → Custom definitions → Create custom dimension.
2. Dimension name: Checkout method
3. Scope: Event
4. Event parameter: `checkout_method`
5. Save.

Note: This parameter is sent on the `begin_checkout` event (and `method` is sent on `checkout_click`).

## Report 1: Checkout Method Overview (Free Form)
Use this to see which method users choose most.

1. Explore → Free form.
2. Dimensions to import:
   - `checkout_method`
   - `device_category`
   - `session_source / medium`
   - `page_location`
3. Metrics to import:
   - `event_count`
   - `total_users`
4. Tab settings:
   - Rows: `checkout_method`
   - Columns (optional): `device_category`
   - Values: `event_count`, `total_users`
5. Filter:
   - `event_name` exactly matches `begin_checkout`

Suggested name: `Checkout Method Overview`.

## Report 2: Funnel by Checkout Method (Funnel Exploration)
Use this to see which method produces the best completion rate.

1. Explore → Funnel exploration.
2. Steps:
   - Step 1: `add_to_cart` (event)
   - Step 2: `begin_checkout` (event)
   - Step 3: `purchase` (event)
3. Breakdown:
   - `checkout_method` (applies to Step 2)
4. Visualization:
   - Open funnel
5. Segment:
   - All users

Suggested name: `Checkout Method Funnel`.

## QA
Verify data is flowing:
- Reproduce a checkout click using each method.
- Confirm `begin_checkout` events show `checkout_method` values in DebugView.
