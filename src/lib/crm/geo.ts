// Countries, states/provinces and their time zones. Shared by the client (pick lists) and the server
// (normalizing imports, setting a record's time zone from its location).

/** ISO code | name | time zone used when no state/province is known (the capital's or the most populous) */
const COUNTRY_ROWS = `
AF|Afghanistan|Asia/Kabul
AL|Albania|Europe/Tirane
DZ|Algeria|Africa/Algiers
AD|Andorra|Europe/Andorra
AO|Angola|Africa/Luanda
AG|Antigua and Barbuda|America/Antigua
AR|Argentina|America/Argentina/Buenos_Aires
AM|Armenia|Asia/Yerevan
AW|Aruba|America/Aruba
AU|Australia|Australia/Sydney
AT|Austria|Europe/Vienna
AZ|Azerbaijan|Asia/Baku
BS|Bahamas|America/Nassau
BH|Bahrain|Asia/Bahrain
BD|Bangladesh|Asia/Dhaka
BB|Barbados|America/Barbados
BY|Belarus|Europe/Minsk
BE|Belgium|Europe/Brussels
BZ|Belize|America/Belize
BJ|Benin|Africa/Porto-Novo
BM|Bermuda|Atlantic/Bermuda
BT|Bhutan|Asia/Thimphu
BO|Bolivia|America/La_Paz
BA|Bosnia and Herzegovina|Europe/Sarajevo
BW|Botswana|Africa/Gaborone
BR|Brazil|America/Sao_Paulo
BN|Brunei|Asia/Brunei
BG|Bulgaria|Europe/Sofia
BF|Burkina Faso|Africa/Ouagadougou
BI|Burundi|Africa/Bujumbura
CV|Cabo Verde|Atlantic/Cape_Verde
KH|Cambodia|Asia/Phnom_Penh
CM|Cameroon|Africa/Douala
CA|Canada|America/Toronto
KY|Cayman Islands|America/Cayman
CF|Central African Republic|Africa/Bangui
TD|Chad|Africa/Ndjamena
CL|Chile|America/Santiago
CN|China|Asia/Shanghai
CO|Colombia|America/Bogota
KM|Comoros|Indian/Comoro
CG|Congo|Africa/Brazzaville
CD|Congo (DRC)|Africa/Kinshasa
CR|Costa Rica|America/Costa_Rica
CI|Côte d'Ivoire|Africa/Abidjan
HR|Croatia|Europe/Zagreb
CU|Cuba|America/Havana
CW|Curaçao|America/Curacao
CY|Cyprus|Asia/Nicosia
CZ|Czechia|Europe/Prague
DK|Denmark|Europe/Copenhagen
DJ|Djibouti|Africa/Djibouti
DM|Dominica|America/Dominica
DO|Dominican Republic|America/Santo_Domingo
EC|Ecuador|America/Guayaquil
EG|Egypt|Africa/Cairo
SV|El Salvador|America/El_Salvador
GQ|Equatorial Guinea|Africa/Malabo
ER|Eritrea|Africa/Asmara
EE|Estonia|Europe/Tallinn
SZ|Eswatini|Africa/Mbabane
ET|Ethiopia|Africa/Addis_Ababa
FO|Faroe Islands|Atlantic/Faroe
FJ|Fiji|Pacific/Fiji
FI|Finland|Europe/Helsinki
FR|France|Europe/Paris
GF|French Guiana|America/Cayenne
PF|French Polynesia|Pacific/Tahiti
GA|Gabon|Africa/Libreville
GM|Gambia|Africa/Banjul
GE|Georgia|Asia/Tbilisi
DE|Germany|Europe/Berlin
GH|Ghana|Africa/Accra
GI|Gibraltar|Europe/Gibraltar
GR|Greece|Europe/Athens
GL|Greenland|America/Nuuk
GD|Grenada|America/Grenada
GP|Guadeloupe|America/Guadeloupe
GU|Guam|Pacific/Guam
GT|Guatemala|America/Guatemala
GG|Guernsey|Europe/Guernsey
GN|Guinea|Africa/Conakry
GW|Guinea-Bissau|Africa/Bissau
GY|Guyana|America/Guyana
HT|Haiti|America/Port-au-Prince
HN|Honduras|America/Tegucigalpa
HK|Hong Kong|Asia/Hong_Kong
HU|Hungary|Europe/Budapest
IS|Iceland|Atlantic/Reykjavik
IN|India|Asia/Kolkata
ID|Indonesia|Asia/Jakarta
IR|Iran|Asia/Tehran
IQ|Iraq|Asia/Baghdad
IE|Ireland|Europe/Dublin
IM|Isle of Man|Europe/Isle_of_Man
IL|Israel|Asia/Jerusalem
IT|Italy|Europe/Rome
JM|Jamaica|America/Jamaica
JP|Japan|Asia/Tokyo
JE|Jersey|Europe/Jersey
JO|Jordan|Asia/Amman
KZ|Kazakhstan|Asia/Almaty
KE|Kenya|Africa/Nairobi
KI|Kiribati|Pacific/Tarawa
XK|Kosovo|Europe/Belgrade
KW|Kuwait|Asia/Kuwait
KG|Kyrgyzstan|Asia/Bishkek
LA|Laos|Asia/Vientiane
LV|Latvia|Europe/Riga
LB|Lebanon|Asia/Beirut
LS|Lesotho|Africa/Maseru
LR|Liberia|Africa/Monrovia
LY|Libya|Africa/Tripoli
LI|Liechtenstein|Europe/Vaduz
LT|Lithuania|Europe/Vilnius
LU|Luxembourg|Europe/Luxembourg
MO|Macao|Asia/Macau
MG|Madagascar|Indian/Antananarivo
MW|Malawi|Africa/Blantyre
MY|Malaysia|Asia/Kuala_Lumpur
MV|Maldives|Indian/Maldives
ML|Mali|Africa/Bamako
MT|Malta|Europe/Malta
MH|Marshall Islands|Pacific/Majuro
MQ|Martinique|America/Martinique
MR|Mauritania|Africa/Nouakchott
MU|Mauritius|Indian/Mauritius
MX|Mexico|America/Mexico_City
FM|Micronesia|Pacific/Pohnpei
MD|Moldova|Europe/Chisinau
MC|Monaco|Europe/Monaco
MN|Mongolia|Asia/Ulaanbaatar
ME|Montenegro|Europe/Podgorica
MA|Morocco|Africa/Casablanca
MZ|Mozambique|Africa/Maputo
MM|Myanmar|Asia/Yangon
NA|Namibia|Africa/Windhoek
NR|Nauru|Pacific/Nauru
NP|Nepal|Asia/Kathmandu
NL|Netherlands|Europe/Amsterdam
NC|New Caledonia|Pacific/Noumea
NZ|New Zealand|Pacific/Auckland
NI|Nicaragua|America/Managua
NE|Niger|Africa/Niamey
NG|Nigeria|Africa/Lagos
KP|North Korea|Asia/Pyongyang
MK|North Macedonia|Europe/Skopje
NO|Norway|Europe/Oslo
OM|Oman|Asia/Muscat
PK|Pakistan|Asia/Karachi
PW|Palau|Pacific/Palau
PS|Palestine|Asia/Gaza
PA|Panama|America/Panama
PG|Papua New Guinea|Pacific/Port_Moresby
PY|Paraguay|America/Asuncion
PE|Peru|America/Lima
PH|Philippines|Asia/Manila
PL|Poland|Europe/Warsaw
PT|Portugal|Europe/Lisbon
PR|Puerto Rico|America/Puerto_Rico
QA|Qatar|Asia/Qatar
RE|Réunion|Indian/Reunion
RO|Romania|Europe/Bucharest
RU|Russia|Europe/Moscow
RW|Rwanda|Africa/Kigali
KN|Saint Kitts and Nevis|America/St_Kitts
LC|Saint Lucia|America/St_Lucia
VC|Saint Vincent and the Grenadines|America/St_Vincent
WS|Samoa|Pacific/Apia
SM|San Marino|Europe/San_Marino
ST|São Tomé and Príncipe|Africa/Sao_Tome
SA|Saudi Arabia|Asia/Riyadh
SN|Senegal|Africa/Dakar
RS|Serbia|Europe/Belgrade
SC|Seychelles|Indian/Mahe
SL|Sierra Leone|Africa/Freetown
SG|Singapore|Asia/Singapore
SX|Sint Maarten|America/Lower_Princes
SK|Slovakia|Europe/Bratislava
SI|Slovenia|Europe/Ljubljana
SB|Solomon Islands|Pacific/Guadalcanal
SO|Somalia|Africa/Mogadishu
ZA|South Africa|Africa/Johannesburg
KR|South Korea|Asia/Seoul
SS|South Sudan|Africa/Juba
ES|Spain|Europe/Madrid
LK|Sri Lanka|Asia/Colombo
SD|Sudan|Africa/Khartoum
SR|Suriname|America/Paramaribo
SE|Sweden|Europe/Stockholm
CH|Switzerland|Europe/Zurich
SY|Syria|Asia/Damascus
TW|Taiwan|Asia/Taipei
TJ|Tajikistan|Asia/Dushanbe
TZ|Tanzania|Africa/Dar_es_Salaam
TH|Thailand|Asia/Bangkok
TL|Timor-Leste|Asia/Dili
TG|Togo|Africa/Lome
TO|Tonga|Pacific/Tongatapu
TT|Trinidad and Tobago|America/Port_of_Spain
TN|Tunisia|Africa/Tunis
TR|Türkiye|Europe/Istanbul
TM|Turkmenistan|Asia/Ashgabat
TC|Turks and Caicos Islands|America/Grand_Turk
TV|Tuvalu|Pacific/Funafuti
UG|Uganda|Africa/Kampala
UA|Ukraine|Europe/Kyiv
AE|United Arab Emirates|Asia/Dubai
GB|United Kingdom|Europe/London
US|United States|America/New_York
UY|Uruguay|America/Montevideo
UZ|Uzbekistan|Asia/Tashkent
VU|Vanuatu|Pacific/Efate
VA|Vatican City|Europe/Vatican
VE|Venezuela|America/Caracas
VN|Vietnam|Asia/Ho_Chi_Minh
VG|British Virgin Islands|America/Tortola
VI|U.S. Virgin Islands|America/St_Thomas
YE|Yemen|Asia/Aden
ZM|Zambia|Africa/Lusaka
ZW|Zimbabwe|Africa/Harare
`;

/** States / provinces with their own time zone: country code → "code|name|time zone" rows */
const REGION_ROWS: Record<string, string> = {
  US: `
AL|Alabama|America/Chicago
AK|Alaska|America/Anchorage
AZ|Arizona|America/Phoenix
AR|Arkansas|America/Chicago
CA|California|America/Los_Angeles
CO|Colorado|America/Denver
CT|Connecticut|America/New_York
DE|Delaware|America/New_York
DC|District of Columbia|America/New_York
FL|Florida|America/New_York
GA|Georgia|America/New_York
HI|Hawaii|Pacific/Honolulu
ID|Idaho|America/Boise
IL|Illinois|America/Chicago
IN|Indiana|America/Indiana/Indianapolis
IA|Iowa|America/Chicago
KS|Kansas|America/Chicago
KY|Kentucky|America/New_York
LA|Louisiana|America/Chicago
ME|Maine|America/New_York
MD|Maryland|America/New_York
MA|Massachusetts|America/New_York
MI|Michigan|America/Detroit
MN|Minnesota|America/Chicago
MS|Mississippi|America/Chicago
MO|Missouri|America/Chicago
MT|Montana|America/Denver
NE|Nebraska|America/Chicago
NV|Nevada|America/Los_Angeles
NH|New Hampshire|America/New_York
NJ|New Jersey|America/New_York
NM|New Mexico|America/Denver
NY|New York|America/New_York
NC|North Carolina|America/New_York
ND|North Dakota|America/Chicago
OH|Ohio|America/New_York
OK|Oklahoma|America/Chicago
OR|Oregon|America/Los_Angeles
PA|Pennsylvania|America/New_York
RI|Rhode Island|America/New_York
SC|South Carolina|America/New_York
SD|South Dakota|America/Chicago
TN|Tennessee|America/Chicago
TX|Texas|America/Chicago
UT|Utah|America/Denver
VT|Vermont|America/New_York
VA|Virginia|America/New_York
WA|Washington|America/Los_Angeles
WV|West Virginia|America/New_York
WI|Wisconsin|America/Chicago
WY|Wyoming|America/Denver
PR|Puerto Rico|America/Puerto_Rico
GU|Guam|Pacific/Guam
VI|U.S. Virgin Islands|America/St_Thomas
`,
  CA: `
AB|Alberta|America/Edmonton
BC|British Columbia|America/Vancouver
MB|Manitoba|America/Winnipeg
NB|New Brunswick|America/Moncton
NL|Newfoundland and Labrador|America/St_Johns
NS|Nova Scotia|America/Halifax
NT|Northwest Territories|America/Edmonton
NU|Nunavut|America/Iqaluit
ON|Ontario|America/Toronto
PE|Prince Edward Island|America/Halifax
QC|Quebec|America/Toronto
SK|Saskatchewan|America/Regina
YT|Yukon|America/Whitehorse
`,
  AU: `
ACT|Australian Capital Territory|Australia/Sydney
NSW|New South Wales|Australia/Sydney
NT|Northern Territory|Australia/Darwin
QLD|Queensland|Australia/Brisbane
SA|South Australia|Australia/Adelaide
TAS|Tasmania|Australia/Hobart
VIC|Victoria|Australia/Melbourne
WA|Western Australia|Australia/Perth
`,
  NZ: `
AUK|Auckland|Pacific/Auckland
BOP|Bay of Plenty|Pacific/Auckland
CAN|Canterbury|Pacific/Auckland
CIT|Chatham Islands|Pacific/Chatham
GIS|Gisborne|Pacific/Auckland
HKB|Hawke's Bay|Pacific/Auckland
MWT|Manawatū-Whanganui|Pacific/Auckland
MBH|Marlborough|Pacific/Auckland
NSN|Nelson|Pacific/Auckland
NTL|Northland|Pacific/Auckland
OTA|Otago|Pacific/Auckland
STL|Southland|Pacific/Auckland
TKI|Taranaki|Pacific/Auckland
TAS|Tasman|Pacific/Auckland
WKO|Waikato|Pacific/Auckland
WGN|Wellington|Pacific/Auckland
WTC|West Coast|Pacific/Auckland
`,
  MX: `
AGU|Aguascalientes|America/Mexico_City
BCN|Baja California|America/Tijuana
BCS|Baja California Sur|America/Mazatlan
CAM|Campeche|America/Merida
CHP|Chiapas|America/Mexico_City
CHH|Chihuahua|America/Chihuahua
CMX|Mexico City|America/Mexico_City
COA|Coahuila|America/Monterrey
COL|Colima|America/Mexico_City
DUR|Durango|America/Monterrey
GUA|Guanajuato|America/Mexico_City
GRO|Guerrero|America/Mexico_City
HID|Hidalgo|America/Mexico_City
JAL|Jalisco|America/Mexico_City
MEX|State of Mexico|America/Mexico_City
MIC|Michoacán|America/Mexico_City
MOR|Morelos|America/Mexico_City
NAY|Nayarit|America/Mazatlan
NLE|Nuevo León|America/Monterrey
OAX|Oaxaca|America/Mexico_City
PUE|Puebla|America/Mexico_City
QUE|Querétaro|America/Mexico_City
ROO|Quintana Roo|America/Cancun
SLP|San Luis Potosí|America/Mexico_City
SIN|Sinaloa|America/Mazatlan
SON|Sonora|America/Hermosillo
TAB|Tabasco|America/Mexico_City
TAM|Tamaulipas|America/Matamoros
TLA|Tlaxcala|America/Mexico_City
VER|Veracruz|America/Mexico_City
YUC|Yucatán|America/Merida
ZAC|Zacatecas|America/Mexico_City
`,
  BR: `
AC|Acre|America/Rio_Branco
AL|Alagoas|America/Maceio
AP|Amapá|America/Belem
AM|Amazonas|America/Manaus
BA|Bahia|America/Bahia
CE|Ceará|America/Fortaleza
DF|Distrito Federal|America/Sao_Paulo
ES|Espírito Santo|America/Sao_Paulo
GO|Goiás|America/Sao_Paulo
MA|Maranhão|America/Fortaleza
MT|Mato Grosso|America/Cuiaba
MS|Mato Grosso do Sul|America/Campo_Grande
MG|Minas Gerais|America/Sao_Paulo
PA|Pará|America/Belem
PB|Paraíba|America/Fortaleza
PR|Paraná|America/Sao_Paulo
PE|Pernambuco|America/Recife
PI|Piauí|America/Fortaleza
RJ|Rio de Janeiro|America/Sao_Paulo
RN|Rio Grande do Norte|America/Fortaleza
RS|Rio Grande do Sul|America/Sao_Paulo
RO|Rondônia|America/Porto_Velho
RR|Roraima|America/Boa_Vista
SC|Santa Catarina|America/Sao_Paulo
SP|São Paulo|America/Sao_Paulo
SE|Sergipe|America/Maceio
TO|Tocantins|America/Araguaina
`,
  GB: `
ENG|England|Europe/London
NIR|Northern Ireland|Europe/London
SCT|Scotland|Europe/London
WLS|Wales|Europe/London
`,
  DE: `
BW|Baden-Württemberg|Europe/Berlin
BY|Bavaria|Europe/Berlin
BE|Berlin|Europe/Berlin
BB|Brandenburg|Europe/Berlin
HB|Bremen|Europe/Berlin
HH|Hamburg|Europe/Berlin
HE|Hesse|Europe/Berlin
MV|Mecklenburg-Vorpommern|Europe/Berlin
NI|Lower Saxony|Europe/Berlin
NW|North Rhine-Westphalia|Europe/Berlin
RP|Rhineland-Palatinate|Europe/Berlin
SL|Saarland|Europe/Berlin
SN|Saxony|Europe/Berlin
ST|Saxony-Anhalt|Europe/Berlin
SH|Schleswig-Holstein|Europe/Berlin
TH|Thuringia|Europe/Berlin
`,
  IN: `
AP|Andhra Pradesh|Asia/Kolkata
AR|Arunachal Pradesh|Asia/Kolkata
AS|Assam|Asia/Kolkata
BR|Bihar|Asia/Kolkata
CT|Chhattisgarh|Asia/Kolkata
DL|Delhi|Asia/Kolkata
GA|Goa|Asia/Kolkata
GJ|Gujarat|Asia/Kolkata
HR|Haryana|Asia/Kolkata
HP|Himachal Pradesh|Asia/Kolkata
JK|Jammu and Kashmir|Asia/Kolkata
JH|Jharkhand|Asia/Kolkata
KA|Karnataka|Asia/Kolkata
KL|Kerala|Asia/Kolkata
MP|Madhya Pradesh|Asia/Kolkata
MH|Maharashtra|Asia/Kolkata
MN|Manipur|Asia/Kolkata
ML|Meghalaya|Asia/Kolkata
MZ|Mizoram|Asia/Kolkata
NL|Nagaland|Asia/Kolkata
OR|Odisha|Asia/Kolkata
PB|Punjab|Asia/Kolkata
RJ|Rajasthan|Asia/Kolkata
SK|Sikkim|Asia/Kolkata
TN|Tamil Nadu|Asia/Kolkata
TG|Telangana|Asia/Kolkata
TR|Tripura|Asia/Kolkata
UP|Uttar Pradesh|Asia/Kolkata
UT|Uttarakhand|Asia/Kolkata
WB|West Bengal|Asia/Kolkata
`,
  AE: `
AZ|Abu Dhabi|Asia/Dubai
AJ|Ajman|Asia/Dubai
DU|Dubai|Asia/Dubai
FU|Fujairah|Asia/Dubai
RK|Ras Al Khaimah|Asia/Dubai
SH|Sharjah|Asia/Dubai
UQ|Umm Al Quwain|Asia/Dubai
`,
};

export interface Country {
  code: string;
  name: string;
  timeZone: string;
}
export interface Region {
  code: string;
  name: string;
  timeZone: string;
}

const rows = (text: string) =>
  text
    .trim()
    .split("\n")
    .map((l) => {
      const [code, name, timeZone] = l.split("|");
      return { code, name, timeZone };
    });

export const COUNTRIES: Country[] = rows(COUNTRY_ROWS).sort((a, b) => a.name.localeCompare(b.name));
const REGIONS = new Map(Object.entries(REGION_ROWS).map(([code, text]) => [code, rows(text).sort((a, b) => a.name.localeCompare(b.name))]));

/** Lower case, no accents or punctuation: "Québec" → "quebec", "U.S.A." → "usa" */
const key = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const COUNTRY_ALIASES: Record<string, string> = {
  usa: "US",
  "united states of america": "US",
  america: "US",
  uk: "GB",
  "great britain": "GB",
  britain: "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  "northern ireland": "GB",
  uae: "AE",
  emirates: "AE",
  ksa: "SA",
  holland: "NL",
  "the netherlands": "NL",
  "czech republic": "CZ",
  turkey: "TR",
  "republic of korea": "KR",
  korea: "KR",
  "korea republic of": "KR",
  "viet nam": "VN",
  "russian federation": "RU",
  "ivory coast": "CI",
  "cote divoire": "CI",
  "cape verde": "CV",
  macedonia: "MK",
  swaziland: "SZ",
  burma: "MM",
  "east timor": "TL",
  "democratic republic of the congo": "CD",
  drc: "CD",
  "republic of the congo": "CG",
  "hong kong sar": "HK",
  macau: "MO",
  "vatican": "VA",
  "holy see": "VA",
  "state of palestine": "PS",
  "brunei darussalam": "BN",
  "lao pdr": "LA",
  "iran islamic republic of": "IR",
  "syrian arab republic": "SY",
  "taiwan province of china": "TW",
  "united republic of tanzania": "TZ",
};

const COUNTRY_BY_KEY = new Map<string, Country>();
for (const c of COUNTRIES) {
  COUNTRY_BY_KEY.set(key(c.name), c);
  COUNTRY_BY_KEY.set(key(c.code), c);
}
for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) COUNTRY_BY_KEY.set(key(alias), COUNTRIES.find((c) => c.code === code)!);

/** "USA", "us", "United States of America" → the country; null when it isn't one we know. */
export function findCountry(raw: string | null | undefined): Country | null {
  if (!raw?.trim()) return null;
  return COUNTRY_BY_KEY.get(key(raw)) ?? null;
}

/** The states/provinces we list for a country (empty when it has none listed). */
export function regionsFor(country: string | null | undefined): Region[] {
  const c = findCountry(country);
  return (c && REGIONS.get(c.code)) || [];
}

/** "TX", "texas" → Texas (within the given country). */
export function findRegion(country: string | null | undefined, raw: string | null | undefined): Region | null {
  if (!raw?.trim()) return null;
  const k = key(raw);
  return regionsFor(country).find((r) => key(r.code) === k || key(r.name) === k) ?? null;
}

/** Country name as stored: the standard name when recognised, else the value as given. */
export function normalizeCountry(raw: string): string {
  return findCountry(raw)?.name ?? raw.trim();
}

/** State/province as stored: the full name when recognised, else the value as given. */
export function normalizeRegion(country: string | null | undefined, raw: string): string {
  return findRegion(country, raw)?.name ?? raw.trim();
}

/** The time zone for a location: the state/province's, else the country's. */
export function timeZoneFor(country: string | null | undefined, state: string | null | undefined): string | null {
  return findRegion(country, state)?.timeZone ?? findCountry(country)?.timeZone ?? null;
}
