(function(){try{
var K='gb_vid',id=localStorage.getItem(K);
if(!id){id='v'+Math.random().toString(36).slice(2)+Date.now().toString(36);try{localStorage.setItem(K,id)}catch(e){}}
function fnv(s){var h=0x811c9dc5;for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h+=(h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24)}return h>>>0}
function gbhash(seed,val,ver){if(ver===1)return(fnv(val+seed)%1000)/1000;return(fnv(String(fnv(val+seed)))%10000)/10000}
function track(n,d){var t=0;(function go(){if(window.umami&&window.umami.track){window.umami.track(n,d)}else if(t++<20){setTimeout(go,300)}})()}
fetch('/api/gb.php').then(function(r){return r.json()}).then(function(d){
var f=(d.features||{}).lead_cta_text;if(!f)return;
var val=f.defaultValue,vIdx=-1;
(f.rules||[]).some(function(rule){
if(!rule.variations)return false;
var ver=rule.hashVersion||2,cov=(rule.coverage==null?1:rule.coverage),w=rule.weights||[];
var n=gbhash(rule.key,id,ver),cum=0,ch=-1;
for(var i=0;i<w.length;i++){cum+=cov*w[i];if(n<cum){ch=i;break}}
if(ch>=0){vIdx=ch;val=rule.variations[ch];return true}return false});
document.querySelectorAll('button.lead__submit').forEach(function(b){b.textContent=val});
if(vIdx>=0)track('exp-lead-cta',{variation:String(vIdx)});
document.querySelectorAll('[data-lead-form]').forEach(function(form){
form.addEventListener('submit',function(){track('lead-submit',{exp:'lead-cta',variation:String(vIdx)})})});
}).catch(function(){});
}catch(e){}})();
