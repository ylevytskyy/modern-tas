/**
 * DI tokens for the AriModule. Kept in a separate file from ari.module.ts to avoid
 * circular imports when services in this module need to `@Inject(ARI_LEADER_TOKEN)`.
 */
export const ARI_LEADER_TOKEN = 'ARI_LEADER';
