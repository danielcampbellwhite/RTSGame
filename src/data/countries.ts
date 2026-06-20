// Seed dataset of real-world nations. Population in millions, GDP in billions USD
// (approximate, modern values — good enough for game balance). Capital coords are
// [lng, lat]. `super` flags the major powers that get larger budgets & reach.
//
// This is a substantial representative set spanning every region. The schema and
// seed scale to the full ~190 — append rows here to extend coverage.

export interface CountrySeed {
  iso3: string;
  name: string;
  capital: [number, number]; // [lng, lat]
  population: number; // millions
  gdp: number; // billions USD
  super?: boolean;
  aggression?: number;
}

export const COUNTRIES: CountrySeed[] = [
  // ── Superpowers / major powers ──
  { iso3: "USA", name: "United States", capital: [-77.0369, 38.9072], population: 335, gdp: 27360, super: true, aggression: 55 },
  { iso3: "CHN", name: "China", capital: [116.4074, 39.9042], population: 1410, gdp: 17790, super: true, aggression: 55 },
  { iso3: "JPN", name: "Japan", capital: [139.6917, 35.6895], population: 124, gdp: 4210, aggression: 30 },
  { iso3: "DEU", name: "Germany", capital: [13.405, 52.52], population: 84, gdp: 4460, aggression: 30 },
  { iso3: "IND", name: "India", capital: [77.209, 28.6139], population: 1430, gdp: 3550, super: true, aggression: 45 },
  { iso3: "GBR", name: "United Kingdom", capital: [-0.1276, 51.5072], population: 68, gdp: 3340, super: true, aggression: 45 },
  { iso3: "FRA", name: "France", capital: [2.3522, 48.8566], population: 65, gdp: 3030, super: true, aggression: 45 },
  { iso3: "RUS", name: "Russia", capital: [37.6173, 55.7558], population: 144, gdp: 2020, super: true, aggression: 75 },
  { iso3: "ITA", name: "Italy", capital: [12.4964, 41.9028], population: 59, gdp: 2250, aggression: 30 },
  { iso3: "BRA", name: "Brazil", capital: [-47.8825, -15.7942], population: 216, gdp: 2170, aggression: 35 },
  { iso3: "CAN", name: "Canada", capital: [-75.6972, 45.4215], population: 40, gdp: 2140, aggression: 25 },

  // ── Asia ──
  { iso3: "KOR", name: "South Korea", capital: [126.978, 37.5665], population: 52, gdp: 1710, aggression: 40 },
  { iso3: "IDN", name: "Indonesia", capital: [106.8456, -6.2088], population: 277, gdp: 1370, aggression: 35 },
  { iso3: "SAU", name: "Saudi Arabia", capital: [46.6753, 24.7136], population: 37, gdp: 1070, aggression: 45 },
  { iso3: "TUR", name: "Turkey", capital: [32.8597, 39.9334], population: 85, gdp: 1110, aggression: 55 },
  { iso3: "TWN", name: "Taiwan", capital: [121.5654, 25.033], population: 24, gdp: 790, aggression: 35 },
  { iso3: "THA", name: "Thailand", capital: [100.5018, 13.7563], population: 72, gdp: 540, aggression: 35 },
  { iso3: "IRN", name: "Iran", capital: [51.389, 35.6892], population: 89, gdp: 410, aggression: 65 },
  { iso3: "PAK", name: "Pakistan", capital: [73.0479, 33.6844], population: 240, gdp: 375, aggression: 55 },
  { iso3: "VNM", name: "Vietnam", capital: [105.8342, 21.0278], population: 99, gdp: 430, aggression: 40 },
  { iso3: "PHL", name: "Philippines", capital: [120.9842, 14.5995], population: 117, gdp: 440, aggression: 35 },
  { iso3: "MYS", name: "Malaysia", capital: [101.6869, 3.139], population: 34, gdp: 430, aggression: 30 },
  { iso3: "BGD", name: "Bangladesh", capital: [90.4125, 23.8103], population: 173, gdp: 460, aggression: 30 },
  { iso3: "ARE", name: "United Arab Emirates", capital: [54.3773, 24.4539], population: 10, gdp: 510, aggression: 35 },
  { iso3: "ISR", name: "Israel", capital: [35.2137, 31.7683], population: 9, gdp: 520, aggression: 60 },
  { iso3: "SGP", name: "Singapore", capital: [103.8198, 1.3521], population: 6, gdp: 500, aggression: 25 },
  { iso3: "PRK", name: "North Korea", capital: [125.7625, 39.0392], population: 26, gdp: 30, aggression: 80 },
  { iso3: "KAZ", name: "Kazakhstan", capital: [71.4704, 51.1605], population: 20, gdp: 260, aggression: 35 },
  { iso3: "IRQ", name: "Iraq", capital: [44.3661, 33.3152], population: 44, gdp: 270, aggression: 50 },
  { iso3: "QAT", name: "Qatar", capital: [51.531, 25.2854], population: 3, gdp: 235, aggression: 30 },

  // ── Europe ──
  { iso3: "ESP", name: "Spain", capital: [-3.7038, 40.4168], population: 48, gdp: 1580, aggression: 25 },
  { iso3: "NLD", name: "Netherlands", capital: [4.9041, 52.3676], population: 18, gdp: 1120, aggression: 25 },
  { iso3: "CHE", name: "Switzerland", capital: [7.4474, 46.948], population: 9, gdp: 905, aggression: 20 },
  { iso3: "POL", name: "Poland", capital: [21.0122, 52.2297], population: 38, gdp: 810, aggression: 40 },
  { iso3: "SWE", name: "Sweden", capital: [18.0686, 59.3293], population: 11, gdp: 600, aggression: 25 },
  { iso3: "BEL", name: "Belgium", capital: [4.3517, 50.8503], population: 12, gdp: 630, aggression: 20 },
  { iso3: "NOR", name: "Norway", capital: [10.7522, 59.9139], population: 5, gdp: 500, aggression: 20 },
  { iso3: "AUT", name: "Austria", capital: [16.3738, 48.2082], population: 9, gdp: 520, aggression: 20 },
  { iso3: "UKR", name: "Ukraine", capital: [30.5234, 50.4501], population: 38, gdp: 180, aggression: 45 },
  { iso3: "GRC", name: "Greece", capital: [23.7275, 37.9838], population: 10, gdp: 240, aggression: 30 },
  { iso3: "PRT", name: "Portugal", capital: [-9.1393, 38.7223], population: 10, gdp: 290, aggression: 20 },
  { iso3: "FIN", name: "Finland", capital: [24.9384, 60.1699], population: 6, gdp: 300, aggression: 25 },
  { iso3: "DNK", name: "Denmark", capital: [12.5683, 55.6761], population: 6, gdp: 400, aggression: 20 },
  { iso3: "IRL", name: "Ireland", capital: [-6.2603, 53.3498], population: 5, gdp: 550, aggression: 20 },
  { iso3: "ROU", name: "Romania", capital: [26.1025, 44.4268], population: 19, gdp: 350, aggression: 30 },
  { iso3: "CZE", name: "Czechia", capital: [14.4378, 50.0755], population: 11, gdp: 330, aggression: 25 },

  // ── Africa ──
  { iso3: "NGA", name: "Nigeria", capital: [7.4951, 9.0579], population: 223, gdp: 390, aggression: 35 },
  { iso3: "EGY", name: "Egypt", capital: [31.2357, 30.0444], population: 113, gdp: 400, aggression: 45 },
  { iso3: "ZAF", name: "South Africa", capital: [28.0473, -26.2041], population: 60, gdp: 380, aggression: 30 },
  { iso3: "DZA", name: "Algeria", capital: [3.0588, 36.7538], population: 45, gdp: 240, aggression: 35 },
  { iso3: "MAR", name: "Morocco", capital: [-6.8498, 33.9716], population: 37, gdp: 140, aggression: 30 },
  { iso3: "KEN", name: "Kenya", capital: [36.8219, -1.2921], population: 55, gdp: 110, aggression: 30 },
  { iso3: "ETH", name: "Ethiopia", capital: [38.7469, 9.03], population: 126, gdp: 160, aggression: 40 },
  { iso3: "AGO", name: "Angola", capital: [13.2343, -8.8383], population: 36, gdp: 110, aggression: 30 },
  { iso3: "GHA", name: "Ghana", capital: [-0.187, 5.6037], population: 34, gdp: 75, aggression: 25 },

  // ── Americas ──
  { iso3: "MEX", name: "Mexico", capital: [-99.1332, 19.4326], population: 129, gdp: 1790, aggression: 35 },
  { iso3: "ARG", name: "Argentina", capital: [-58.3816, -34.6037], population: 46, gdp: 640, aggression: 35 },
  { iso3: "COL", name: "Colombia", capital: [-74.0721, 4.711], population: 52, gdp: 360, aggression: 35 },
  { iso3: "CHL", name: "Chile", capital: [-70.6693, -33.4489], population: 20, gdp: 330, aggression: 25 },
  { iso3: "PER", name: "Peru", capital: [-77.0428, -12.0464], population: 34, gdp: 270, aggression: 30 },
  { iso3: "VEN", name: "Venezuela", capital: [-66.9036, 10.4806], population: 28, gdp: 95, aggression: 45 },

  // ── Oceania ──
  { iso3: "AUS", name: "Australia", capital: [149.13, -35.2809], population: 26, gdp: 1690, aggression: 25 },
  { iso3: "NZL", name: "New Zealand", capital: [174.7762, -41.2865], population: 5, gdp: 250, aggression: 20 },
];

// Real major cities for the example countries in the design spec, used to make
// their territory sectors authentic. Other countries get procedurally placed
// sectors around their capital in the seed.
export const KNOWN_SECTORS: Record<
  string,
  { name: string; lng: number; lat: number; kind: string }[]
> = {
  GBR: [
    { name: "London", lng: -0.1276, lat: 51.5072, kind: "CAPITAL" },
    { name: "Birmingham", lng: -1.8904, lat: 52.4862, kind: "INDUSTRIAL" },
    { name: "Manchester", lng: -2.2426, lat: 53.4808, kind: "MAJOR_CITY" },
    { name: "Liverpool", lng: -2.9916, lat: 53.4084, kind: "PORT" },
    { name: "Scotland", lng: -4.2026, lat: 56.4907, kind: "RURAL" },
    { name: "Wales", lng: -3.7837, lat: 52.1307, kind: "RURAL" },
  ],
  FRA: [
    { name: "Paris", lng: 2.3522, lat: 48.8566, kind: "CAPITAL" },
    { name: "Marseille", lng: 5.3698, lat: 43.2965, kind: "PORT" },
    { name: "Lyon", lng: 4.8357, lat: 45.764, kind: "INDUSTRIAL" },
    { name: "Bordeaux", lng: -0.5792, lat: 44.8378, kind: "MAJOR_CITY" },
  ],
};
