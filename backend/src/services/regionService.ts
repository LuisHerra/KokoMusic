/**
 * regionService.ts — KokoMusic User Region & Language Management
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

  if (clean.includes('es-mx') || clean === 'mexico' || clean === 'méxico' || clean === 'mx') {
    return 'mexico';
  }
  if (clean.includes('es-ar') || clean === 'argentina' || clean === 'ar') {
    return 'argentina';
  }
  if (clean.includes('es-co') || clean === 'colombia' || clean === 'co') {
    return 'colombia';
  }
  if (clean.includes('es-cl') || clean === 'chile' || clean === 'cl') {
    return 'chile';
  }
  if (clean.includes('es-es') || clean === 'es' || clean === 'spain' || clean === 'españa') {
    return 'spain';
  }
  if (clean.includes('en-gb') || clean.includes('united kingdom') || clean === 'uk' || clean === 'gb') {
    return 'united kingdom';
  }
  if (clean.includes('en-us') || clean.includes('united states') || clean === 'us') {
    return 'united states';
  }
  if (clean.includes('de') || clean.includes('germany') || clean.includes('deutschland')) {
    return 'germany';
  }
  if (clean.includes('fr') || clean.includes('france')) {
    return 'france';
  }

  // Language prefix fallbacks
  if (clean.startsWith('es')) return 'spain';
  if (clean.startsWith('en')) return 'united states';

  return 'spain';
}

/** Converts normalized region name to 2-letter ISO country code for iTunes RSS / Last.fm APIs */
export function getRegionISOCode(region: string): string {
  const norm = normalizeRegionName(region);
  switch (norm) {
    case 'mexico': return 'mx';
    case 'argentina': return 'ar';
    case 'colombia': return 'co';
    case 'chile': return 'cl';
    case 'united kingdom': return 'gb';
    case 'united states': return 'us';
    case 'germany': return 'de';
    case 'france': return 'fr';
    case 'spain':
    default: return 'es';
  }
}
