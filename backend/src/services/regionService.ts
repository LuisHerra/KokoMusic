/**
 * regionService.ts — KokoMusic User Region Management
 *
 * Keeps track of active user session regions in-memory to drive localized trending recommendations.
 */

export const userRegions = new Map<string, string>();

export function setUserRegion(userId: string, region?: string): void {
  if (region) {
    const normalized = normalizeRegionName(region);
    userRegions.set(userId, normalized);
    console.log(`[RegionService] Associated user '${userId}' with region '${normalized}'`);
  }
}

export function getUserRegion(userId: string): string {
  return userRegions.get(userId) || 'spain';
}

export function normalizeRegionName(regionHeader?: string): string {
  if (!regionHeader) return 'spain';
  const clean = regionHeader.toLowerCase().trim();
  if (clean.includes('es-es') || clean === 'es' || clean === 'spain' || clean === 'españa') {
    return 'spain';
  }
  if (clean.includes('es-mx') || clean === 'mexico' || clean === 'méxico') {
    return 'mexico';
  }
  if (clean.includes('en-gb') || clean.includes('united kingdom') || clean === 'uk') {
    return 'united kingdom';
  }
  if (clean.includes('en-us') || clean.includes('united states') || clean === 'us') {
    return 'united states';
  }
  
  // Fallbacks by language prefix
  if (clean.startsWith('es')) return 'spain';
  if (clean.startsWith('en')) return 'united states';
  
  return 'spain';
}
