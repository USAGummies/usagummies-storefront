// ============================================================================
// USA Gummies — Follow-Up Message Templates
// ============================================================================

import { BRAND, FTC } from '../config.mjs';

function displayName(influencer) {
  return influencer.firstName || influencer.username || 'there';
}

// ---------------------------------------------------------------------------
// 1. No response after initial contact (gentle nudge, day 3)
// ---------------------------------------------------------------------------
export function noResponseNudge(influencer) {
  const name = displayName(influencer);
  return {
    id: 'no_response_nudge',
    label: 'Gentle Nudge (No Response)',
    triggerDaysAfter: 3,
    triggerAfterStage: 'contacted',
    message: [
      `Hey ${name}! Just bumping this in case it got buried.`,
      `We'd love to send you some ${BRAND.productName} to try -- totally free, no obligation.`,
      `If you're interested just let me know where to ship them!`,
      `If not, no worries at all. Keep up the great content!`,
    ].join(' '),
  };
}

// ---------------------------------------------------------------------------
// 2. Second nudge (day 7 after first nudge, still no response)
// ---------------------------------------------------------------------------
export function secondNudge(influencer) {
  const name = displayName(influencer);
  return {
    id: 'second_nudge',
    label: 'Final Check-In (No Response)',
    triggerDaysAfter: 7,
    triggerAfterStage: 'no_response_nudge',
    message: [
      `Hi ${name} -- last message from me, promise!`,
      `If you'd ever like to try our gummy bears, the offer's always open.`,
      `Wishing you the best!`,
      `-- ${BRAND.founderName}, ${BRAND.name}`,
    ].join(' '),
  };
}

// ---------------------------------------------------------------------------
// 3. Positive response -- confirm shipping details
// ---------------------------------------------------------------------------
export function confirmShipping(influencer) {
  const name = displayName(influencer);
  return {
    id: 'confirm_shipping',
    label: 'Confirm Shipping Address',
    triggerDaysAfter: 0,
    triggerAfterStage: 'responded',
    message: [
      `Awesome, ${name}! So glad you're down to try them.`,
      `Could you send me your shipping address? I'll get a pack out to you ASAP.`,
      `Name:\nStreet:\nCity, State, Zip:`,
      `\nThanks!`,
    ].join('\n'),
  };
}

// ---------------------------------------------------------------------------
// 4. Product shipped -- tracking notification
// ---------------------------------------------------------------------------
export function trackingNotification(influencer, trackingNumber = '{{TRACKING_NUMBER}}', carrier = '{{CARRIER}}') {
  const name = displayName(influencer);
  return {
    id: 'tracking_notification',
    label: 'Tracking Notification',
    triggerDaysAfter: 0,
    triggerAfterStage: 'product_sent',
    message: [
      `Hey ${name}! Your ${BRAND.productName} are on the way!`,
      `\nTracking: ${trackingNumber} (${carrier})`,
      `\nShould arrive in 3-5 business days. Let me know when they land!`,
    ].join('\n'),
  };
}

// ---------------------------------------------------------------------------
// 5. Delivery check-in (7 days after shipment)
// ---------------------------------------------------------------------------
export function deliveryCheckin(influencer) {
  const name = displayName(influencer);
  return {
    id: 'delivery_checkin',
    label: 'Post-Delivery Check-In',
    triggerDaysAfter: 7,
    triggerAfterStage: 'product_sent',
    message: [
      `Hey ${name}! Just wanted to check in -- did the gummy bears arrive?`,
      `I'd love to hear what you think! Which flavor was your favorite?`,
      `No pressure to post or anything -- just genuinely curious.`,
    ].join(' '),
  };
}

// ---------------------------------------------------------------------------
// 6. They posted -- thank you + ongoing relationship offer
// ---------------------------------------------------------------------------
export function thankYouForPost(influencer, postUrl = '{{POST_URL}}') {
  const name = displayName(influencer);
  return {
    id: 'thank_you_post',
    label: 'Thank You for Posting',
    triggerDaysAfter: 0,
    triggerAfterStage: 'posted',
    message: [
      `${name}!! Thank you so much for sharing about ${BRAND.name}!`,
      `Your post was amazing and we really appreciate the love.`,
      `\nWe'd love to keep you stocked up -- happy to send more anytime.`,
      `And if you're ever interested in an ongoing collab or affiliate deal, just say the word.`,
      `\nThanks again for the support!`,
      `-- ${BRAND.founderName}`,
    ].join('\n'),
  };
}

// ---------------------------------------------------------------------------
// 7. Soft follow-up if they didn't post (14 days after delivery)
// ---------------------------------------------------------------------------
export function softFollowupNoPost(influencer) {
  const name = displayName(influencer);
  return {
    id: 'soft_followup_no_post',
    label: 'Soft Follow-Up (No Post)',
    triggerDaysAfter: 14,
    triggerAfterStage: 'product_sent',
    message: [
      `Hey ${name}! Hope you enjoyed the gummy bears!`,
      `Just checking in -- if you ever want to share your thoughts with your audience, we'd love that.`,
      `But zero pressure at all. If you'd like another bag of a different variety, just let me know!`,
      `\nCheers,\n${BRAND.founderName}`,
    ].join(' '),
  };
}

// ---------------------------------------------------------------------------
// 8. FTC disclosure reminder (included in packing slip, but also sendable)
// ---------------------------------------------------------------------------
export function ftcDisclosureReminder(influencer) {
  const name = displayName(influencer);
  return {
    id: 'ftc_disclosure_reminder',
    label: 'FTC Disclosure Reminder',
    triggerDaysAfter: 0,
    triggerAfterStage: 'posted',
    message: [
      `Hey ${name}! Quick heads-up -- since we gifted you the product, the FTC asks that you include a disclosure like #gifted or #ad in your post.`,
      `Just want to make sure we're both covered!`,
      `Thanks for being awesome.`,
    ].join(' '),
  };
}

// ---------------------------------------------------------------------------
// Template registry
// ---------------------------------------------------------------------------
export const FOLLOWUP_TEMPLATES = {
  no_response_nudge:      { id: 'no_response_nudge',      fn: noResponseNudge },
  second_nudge:           { id: 'second_nudge',            fn: secondNudge },
  confirm_shipping:       { id: 'confirm_shipping',        fn: confirmShipping },
  tracking_notification:  { id: 'tracking_notification',   fn: trackingNotification },
  delivery_checkin:       { id: 'delivery_checkin',         fn: deliveryCheckin },
  thank_you_post:         { id: 'thank_you_post',           fn: thankYouForPost },
  soft_followup_no_post:  { id: 'soft_followup_no_post',    fn: softFollowupNoPost },
  ftc_disclosure_reminder:{ id: 'ftc_disclosure_reminder',  fn: ftcDisclosureReminder },
};

// ---------------------------------------------------------------------------
// Get the appropriate follow-up for an influencer given their current stage
// ---------------------------------------------------------------------------
export function getNextFollowup(influencer, daysSinceLastAction) {
  const stage = influencer.stage;
  const suggestions = [];

  if (stage === 'contacted' && daysSinceLastAction >= 3) {
    suggestions.push(noResponseNudge(influencer));
  }
  if (stage === 'responded') {
    suggestions.push(confirmShipping(influencer));
  }
  if (stage === 'product_sent' && daysSinceLastAction >= 7) {
    suggestions.push(deliveryCheckin(influencer));
  }
  if (stage === 'product_sent' && daysSinceLastAction >= 14) {
    suggestions.push(softFollowupNoPost(influencer));
  }
  if (stage === 'posted') {
    suggestions.push(thankYouForPost(influencer));
  }

  return suggestions;
}

export default { FOLLOWUP_TEMPLATES, getNextFollowup };
