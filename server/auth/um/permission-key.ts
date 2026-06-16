export function buildPermissionKey(
  appId: string,
  collectionId: string,
  capabilityId: string,
): string {
  return `${appId}:${collectionId}:${capabilityId}`;
}
