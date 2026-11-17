// Kenya's 47 counties and 290 constituencies (build 2871), from the IEBC list of registered voters per constituency (2022). One list serves the server
// checks and the client set-up screen; the page copy is a byte-for-byte copy of this file, and a test fails if they differ.
// Each county is [county code, name, [[constituency code, name], ...]]. A constituency is the "sub-county" the firm records under District on the iTax profile.
// Nothing is guessed: a typed name is accepted only when it matches a listed name once case, spaces and punctuation are ignored, or is a listed alias.
export const COUNTIES_RAW=[
 [1,"Mombasa",[[1,"Changamwe"],[2,"Jomvu"],[3,"Kisauni"],[4,"Nyali"],[5,"Likoni"],[6,"Mvita"]]],
 [2,"Kwale",[[7,"Msambweni"],[8,"Lungalunga"],[9,"Matuga"],[10,"Kinango"]]],
 [3,"Kilifi",[[11,"Kilifi North"],[12,"Kilifi South"],[13,"Kaloleni"],[14,"Rabai"],[15,"Ganze"],[16,"Malindi"],[17,"Magarini"]]],
 [4,"Tana River",[[18,"Garsen"],[19,"Galole"],[20,"Bura"]]],
 [5,"Lamu",[[21,"Lamu East"],[22,"Lamu West"]]],
 [6,"Taita Taveta",[[23,"Taveta"],[24,"Wundanyi"],[25,"Mwatate"],[26,"Voi"]]],
 [7,"Garissa",[[27,"Garissa Township"],[28,"Balambala"],[29,"Lagdera"],[30,"Dadaab"],[31,"Fafi"],[32,"Ijara"]]],
 [8,"Wajir",[[33,"Wajir North"],[34,"Wajir East"],[35,"Tarbaj"],[36,"Wajir West"],[37,"Eldas"],[38,"Wajir South"]]],
 [9,"Mandera",[[39,"Mandera West"],[40,"Banissa"],[41,"Mandera North"],[42,"Mandera South"],[43,"Mandera East"],[44,"Lafey"]]],
 [10,"Marsabit",[[45,"Moyale"],[46,"North Horr"],[47,"Saku"],[48,"Laisamis"]]],
 [11,"Isiolo",[[49,"Isiolo North"],[50,"Isiolo South"]]],
 [12,"Meru",[[51,"Igembe South"],[52,"Igembe Central"],[53,"Igembe North"],[54,"Tigania West"],[55,"Tigania East"],[56,"North Imenti"],[57,"Buuri"],[58,"Central Imenti"],[59,"South Imenti"]]],
 [13,"Tharaka-Nithi",[[60,"Maara"],[61,"Chuka/Igambang'ombe"],[62,"Tharaka"]]],
 [14,"Embu",[[63,"Manyatta"],[64,"Runyenjes"],[65,"Mbeere South"],[66,"Mbeere North"]]],
 [15,"Kitui",[[67,"Mwingi North"],[68,"Mwingi West"],[69,"Mwingi Central"],[70,"Kitui West"],[71,"Kitui Rural"],[72,"Kitui Central"],[73,"Kitui East"],[74,"Kitui South"]]],
 [16,"Machakos",[[75,"Masinga"],[76,"Yatta"],[77,"Kangundo"],[78,"Matungulu"],[79,"Kathiani"],[80,"Mavoko"],[81,"Machakos Town"],[82,"Mwala"]]],
 [17,"Makueni",[[83,"Mbooni"],[84,"Kilome"],[85,"Kaiti"],[86,"Makueni"],[87,"Kibwezi West"],[88,"Kibwezi East"]]],
 [18,"Nyandarua",[[89,"Kinangop"],[90,"Kipipiri"],[91,"Ol Kalou"],[92,"Ol Jorok"],[93,"Ndaragwa"]]],
 [19,"Nyeri",[[94,"Tetu"],[95,"Kieni"],[96,"Mathira"],[97,"Othaya"],[98,"Mukurweini"],[99,"Nyeri Town"]]],
 [20,"Kirinyaga",[[100,"Mwea"],[101,"Gichugu"],[102,"Ndia"],[103,"Kirinyaga Central"]]],
 [21,"Murang'a",[[104,"Kangema"],[105,"Mathioya"],[106,"Kiharu"],[107,"Kigumo"],[108,"Maragwa"],[109,"Kandara"],[110,"Gatanga"]]],
 [22,"Kiambu",[[111,"Gatundu South"],[112,"Gatundu North"],[113,"Juja"],[114,"Thika Town"],[115,"Ruiru"],[116,"Githunguri"],[117,"Kiambu"],[118,"Kiambaa"],[119,"Kabete"],[120,"Kikuyu"],[121,"Limuru"],[122,"Lari"]]],
 [23,"Turkana",[[123,"Turkana North"],[124,"Turkana West"],[125,"Turkana Central"],[126,"Loima"],[127,"Turkana South"],[128,"Turkana East"]]],
 [24,"West Pokot",[[129,"Kapenguria"],[130,"Sigor"],[131,"Kacheliba"],[132,"Pokot South"]]],
 [25,"Samburu",[[133,"Samburu West"],[134,"Samburu North"],[135,"Samburu East"]]],
 [26,"Trans Nzoia",[[136,"Kwanza"],[137,"Endebess"],[138,"Saboti"],[139,"Kiminini"],[140,"Cherangany"]]],
 [27,"Uasin Gishu",[[141,"Soy"],[142,"Turbo"],[143,"Moiben"],[144,"Ainabkoi"],[145,"Kapseret"],[146,"Kesses"]]],
 [28,"Elgeyo/Marakwet",[[147,"Marakwet East"],[148,"Marakwet West"],[149,"Keiyo North"],[150,"Keiyo South"]]],
 [29,"Nandi",[[151,"Tinderet"],[152,"Aldai"],[153,"Nandi Hills"],[154,"Chesumei"],[155,"Emgwen"],[156,"Mosop"]]],
 [30,"Baringo",[[157,"Tiaty"],[158,"Baringo North"],[159,"Baringo Central"],[160,"Baringo South"],[161,"Mogotio"],[162,"Eldama Ravine"]]],
 [31,"Laikipia",[[163,"Laikipia West"],[164,"Laikipia East"],[165,"Laikipia North"]]],
 [32,"Nakuru",[[166,"Molo"],[167,"Njoro"],[168,"Naivasha"],[169,"Gilgil"],[170,"Kuresoi South"],[171,"Kuresoi North"],[172,"Subukia"],[173,"Rongai"],[174,"Bahati"],[175,"Nakuru Town West"],[176,"Nakuru Town East"]]],
 [33,"Narok",[[177,"Kilgoris"],[178,"Emurua Dikirr"],[179,"Narok North"],[180,"Narok East"],[181,"Narok South"],[182,"Narok West"]]],
 [34,"Kajiado",[[183,"Kajiado North"],[184,"Kajiado Central"],[185,"Kajiado East"],[186,"Kajiado West"],[187,"Kajiado South"]]],
 [35,"Kericho",[[188,"Kipkelion East"],[189,"Kipkelion West"],[190,"Ainamoi"],[191,"Bureti"],[192,"Belgut"],[193,"Sigowet/Soin"]]],
 [36,"Bomet",[[194,"Sotik"],[195,"Chepalungu"],[196,"Bomet East"],[197,"Bomet Central"],[198,"Konoin"]]],
 [37,"Kakamega",[[199,"Lugari"],[200,"Likuyani"],[201,"Malava"],[202,"Lurambi"],[203,"Navakholo"],[204,"Mumias West"],[205,"Mumias East"],[206,"Matungu"],[207,"Butere"],[208,"Khwisero"],[209,"Shinyalu"],[210,"Ikolomani"]]],
 [38,"Vihiga",[[211,"Vihiga"],[212,"Sabatia"],[213,"Hamisi"],[214,"Luanda"],[215,"Emuhaya"]]],
 [39,"Bungoma",[[216,"Mt. Elgon"],[217,"Sirisia"],[218,"Kabuchai"],[219,"Bumula"],[220,"Kanduyi"],[221,"Webuye East"],[222,"Webuye West"],[223,"Kimilili"],[224,"Tongaren"]]],
 [40,"Busia",[[225,"Teso North"],[226,"Teso South"],[227,"Nambale"],[228,"Matayos"],[229,"Butula"],[230,"Funyula"],[231,"Budalangi"]]],
 [41,"Siaya",[[232,"Ugenya"],[233,"Ugunja"],[234,"Alego Usonga"],[235,"Gem"],[236,"Bondo"],[237,"Rarieda"]]],
 [42,"Kisumu",[[238,"Kisumu East"],[239,"Kisumu West"],[240,"Kisumu Central"],[241,"Seme"],[242,"Nyando"],[243,"Muhoroni"],[244,"Nyakach"]]],
 [43,"Homa Bay",[[245,"Kasipul"],[246,"Kabondo Kasipul"],[247,"Karachuonyo"],[248,"Rangwe"],[249,"Homa Bay Town"],[250,"Ndhiwa"],[251,"Suba North"],[252,"Suba South"]]],
 [44,"Migori",[[253,"Rongo"],[254,"Awendo"],[255,"Suna East"],[256,"Suna West"],[257,"Uriri"],[258,"Nyatike"],[259,"Kuria West"],[260,"Kuria East"]]],
 [45,"Kisii",[[261,"Bonchari"],[262,"South Mugirango"],[263,"Bomachoge Borabu"],[264,"Bobasi"],[265,"Bomachoge Chache"],[266,"Nyaribari Masaba"],[267,"Nyaribari Chache"],[268,"Kitutu Chache North"],[269,"Kitutu Chache South"]]],
 [46,"Nyamira",[[270,"Kitutu Masaba"],[271,"West Mugirango"],[272,"North Mugirango"],[273,"Borabu"]]],
 [47,"Nairobi City",[[274,"Westlands"],[275,"Dagoretti North"],[276,"Dagoretti South"],[277,"Langata"],[278,"Kibra"],[279,"Roysambu"],[280,"Kasarani"],[281,"Ruaraka"],[282,"Embakasi South"],[283,"Embakasi North"],[284,"Embakasi Central"],[285,"Embakasi East"],[286,"Embakasi West"],[287,"Makadara"],[288,"Kamukunji"],[289,"Starehe"],[290,"Mathare"]]],
];
export const COUNTIES=COUNTIES_RAW.map(([code,name,list])=>({code,name,constituencies:list.map(([c,n])=>({code:c,name:n}))}));
// A name the iTax page or common use gives differently from the IEBC list. Keys are letters only, lower case.
const ALIASES={nairobi:'Nairobi City',nairobicounty:'Nairobi City',elgeyomarakwet:'Elgeyo/Marakwet',tharakanithi:'Tharaka-Nithi'};
const letters=s=>String(s??'').toLowerCase().replace(/[^a-z]/g,'');
const COUNTY_BY_KEY=new Map(COUNTIES.map(c=>[letters(c.name),c]));
export const countyNames=()=>COUNTIES.map(c=>c.name);
// The listed county a typed name means, or null.
export function countyOf(text){
 const k=letters(text);if(!k)return null;
 const c=COUNTY_BY_KEY.get(k)||(ALIASES[k]?COUNTY_BY_KEY.get(letters(ALIASES[k])):null);
 return c||null;
}
export const canonicalCounty=text=>{const c=countyOf(text);return c?c.name:null;};
export const constituencyNames=county=>{const c=countyOf(county);return c?c.constituencies.map(x=>x.name):[];};
// The listed constituency of that county that a typed name means, or null.
export function canonicalConstituency(county,text){
 const c=countyOf(county),k=letters(text);if(!c||!k)return null;
 const m=c.constituencies.find(x=>letters(x.name)===k);return m?m.name:null;
}
// What is wrong with a county and constituency pair, in words, or null. Both are stored values.
export function locationProblem(county,constituency){
 if(!constituency)return null;
 if(!county)return 'Choose the county first. The constituency list follows the county.';
 const c=countyOf(county);
 if(!c)return 'The county is not one of the 47 counties on the IEBC list. Correct the county first.';
 if(!canonicalConstituency(county,constituency))return `${constituency} is not a constituency of ${c.name} County. Choose one from the list.`;
 return null;
}
