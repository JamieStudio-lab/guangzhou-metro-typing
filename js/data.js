/* ============================================================
   DATA — Guangzhou Metro Lines 1 / 2 / 3 (classic main segments)
   Station tuple: [汉字, pinyin(toned), x, y, labelPos, transfers?]
   x/y are schematic fallbacks — real positions are projected from
   js/geo.js (matched by 汉字) when it is loaded.
   labelPos: l left · r right · a above · b below
             ul upper-left · ur upper-right · bl below-left · br below-right
============================================================ */
/*__DATA__*/
const TONE={"ā":"a","á":"a","ǎ":"a","à":"a","ē":"e","é":"e","ě":"e","è":"e",
"ī":"i","í":"i","ǐ":"i","ì":"i","ō":"o","ó":"o","ǒ":"o","ò":"o",
"ū":"u","ú":"u","ǔ":"u","ù":"u","ü":"v","ǖ":"v","ǘ":"v","ǚ":"v","ǜ":"v"};
function normPy(s){let o="";for(const ch of s.toLowerCase()){const c=TONE[ch]||ch;if(c>="a"&&c<="z")o+=c}return o}

const LINES=[
{id:"l1",num:"1",zh:"一号线",en:"Line 1",color:"#F3D03E",cap:80,
 fact:"广州首条地铁线，1997 年开通 · Guangzhou's first metro line (opened 1997).",
 st:[
  ["西塱","Xīlǎng",100,950,"l",["GF","22"]],
  ["坑口","Kēngkǒu",140,901,"l"],
  ["花地湾","Huādìwān",180,852,"l"],
  ["芳村","Fāngcūn",220,803,"l",["GF"]],
  ["黄沙","Huángshā",260,754,"l",["6"]],
  ["长寿路","Chángshòu Lù",300,705,"l"],
  ["陈家祠","Chénjiācí",340,656,"ul",["8"]],
  ["西门口","Xīménkǒu",380,606,"a"],
  ["公园前","Gōngyuánqián",420,557,"bl"],
  ["农讲所","Nóngjiǎngsuǒ",476,543,"a"],
  ["烈士陵园","Lièshì Língyuán",532,528,"b"],
  ["东山口","Dōngshānkǒu",588,514,"a",["6"]],
  ["杨箕","Yángjī",644,499,"a",["5"]],
  ["体育西路","Tǐyù Xīlù",700,485,"bl"],
  ["体育中心","Tǐyù Zhōngxīn",762,452,"ul"],
  ["广州东站","Guǎngzhōu Dōngzhàn",824,418,"l",["3","11"]]
 ],
 segKm:[1.4,0.9,0.9,1.7,0.9,0.9,0.8,0.9,1.0,0.9,1.2,1.6,1.8,1.0,1.6]},

{id:"l2",num:"2",zh:"二号线",en:"Line 2",color:"#00629B",cap:80,
 fact:"纵贯南北，一线连起广州南站与广州火车站两大铁路枢纽 · Links both major railway hubs.",
 st:[
  ["广州南站","Guǎngzhōu Nánzhàn",420,1085,"b",["7","22"]],
  ["石壁","Shíbì",420,1041,"l",["7"]],
  ["会江","Huìjiāng",420,997,"l"],
  ["南浦","Nánpǔ",420,953,"l"],
  ["洛溪","Luòxī",420,909,"l"],
  ["南洲","Nánzhōu",420,865,"l",["GF"]],
  ["东晓南","Dōngxiǎonán",420,821,"l"],
  ["江泰路","Jiāngtài Lù",420,777,"l"],
  ["昌岗","Chānggǎng",420,733,"l",["8"]],
  ["江南西","Jiāngnánxī",420,689,"l"],
  ["市二宫","Shì'èrgōng",420,645,"r"],
  ["海珠广场","Hǎizhū Guǎngchǎng",420,601,"bl",["6"]],
  ["公园前","Gōngyuánqián",420,557,"bl"],
  ["纪念堂","Jìniàntáng",420,513,"ur"],
  ["越秀公园","Yuèxiù Gōngyuán",420,469,"l"],
  ["广州火车站","Guǎngzhōu Huǒchēzhàn",420,425,"l",["5","11"]],
  ["三元里","Sānyuánlǐ",420,381,"l"],
  ["飞翔公园","Fēixiáng Gōngyuán",420,337,"l"],
  ["白云公园","Báiyún Gōngyuán",420,293,"l"],
  ["白云文化广场","Báiyún Wénhuà Guǎngchǎng",420,249,"l"],
  ["萧岗","Xiāogǎng",420,205,"l"],
  ["江夏","Jiāngxià",420,161,"l"],
  ["黄边","Huángbiān",420,117,"l"],
  ["嘉禾望岗","Jiāhé Wànggǎng",420,73,"a",["3","14"]]
 ],
 segKm:[2.6,2.2,2.2,2.0,2.6,1.3,1.0,0.9,0.9,0.9,1.0,0.9,0.9,0.8,1.0,1.2,1.5,1.2,1.1,1.1,1.0,1.0,1.3]},

{id:"l3",num:"3",zh:"三号线",en:"Line 3",color:"#ECA154",cap:120,
 fact:"最高时速 120 km/h，全国客流最繁忙的地铁线之一 · Tops out at 120 km/h — one of China's busiest lines.",
 st:[
  ["番禺广场","Pānyú Guǎngchǎng",700,1085,"r",["18","22"]],
  ["市桥","Shìqiáo",700,1025,"r"],
  ["汉溪长隆","Hànxī Chánglóng",700,965,"r",["7"]],
  ["大石","Dàshí",700,905,"r"],
  ["厦滘","Xiàjiào",700,845,"r"],
  ["沥滘","Lìjiào",700,785,"r",["GF"]],
  ["大塘","Dàtáng",700,725,"r"],
  ["客村","Kècūn",700,665,"r",["8"]],
  ["广州塔","Guǎngzhōu Tǎ",700,605,"r",["APM"]],
  ["珠江新城","Zhūjiāng Xīnchéng",700,545,"r",["5"]],
  ["体育西路","Tǐyù Xīlù",700,485,"bl"],
  ["石牌桥","Shípáiqiáo",700,425,"b"],
  ["岗顶","Gǎngdǐng",700,365,"br"],
  ["华师","Huáshī",700,305,"r"],
  ["五山","Wǔshān",700,245,"r"],
  ["天河客运站","Tiānhé Kèyùnzhàn",700,185,"a",["6"]]
 ],
 segKm:[1.5,4.3,1.9,2.0,2.6,2.2,1.8,1.9,1.4,1.5,1.1,0.9,1.0,1.1,1.9]}
];
/*__END_DATA__*/
