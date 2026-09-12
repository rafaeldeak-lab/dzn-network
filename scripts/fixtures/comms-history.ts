export function commsHistoryFixture() {
  return {
    ok: true, generated_at: "2026-09-13T00:00:00.000Z", read_only: true, presentation_only: true,
    channel: { slug: "global-chat", kind: "public", name: "Global Chat", description: null, visibility: "public" },
    access: { public_channel: true, private_group_membership_required: false, current_user_member_role: null },
    messages: [{ id: "qa-message-1", author_display_name: "DZN QA", author_role_label: "Member", body: "Local history fixture",
      visibility_state: "visible", created_at: "2026-09-13 00:00:00", edited_at: null, public_safe: true, read_only: true }],
    feature_flags: { route_enabled: true, sending_enabled: false, reactions_enabled: false, report_actions_enabled: false,
      moderation_mutations_enabled: false, ai_assist_runtime_enabled: false, durable_objects_or_websockets_enabled: false,
      analytics_or_tracking_enabled: false },
    fairness_boundary: ["Local read-only fixture. No production services."],
  };
}
