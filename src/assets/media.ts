export const MEDIA_ASSETS = {
  hero: '/src/assets/images/hero_bazaarbridge_electronics_1795285502891.jpg',
  categories: {
    'Audio & Speakers': '/src/assets/images/cat_audio_speaker_1795285512126.jpg',
    'Computing & Peripherals': '/src/assets/images/cat_computing_gear_1795285543901.jpg',
    'Wearables & Smartwatches': '/src/assets/images/cat_wearables_watch_1795285504545.jpg',
    'Home & Kitchen Tech': '/src/assets/images/cat_home_tech_1795285505947.jpg',
    'Mobile & Power Gear': '/src/assets/images/cat_mobile_power_1795285569545.jpg',
  } as Record<string, string>,
};

export function getCategoryImage(categoryName?: string): string {
  if (!categoryName) return MEDIA_ASSETS.categories['Audio & Speakers'];
  return MEDIA_ASSETS.categories[categoryName] || MEDIA_ASSETS.categories['Audio & Speakers'];
}
