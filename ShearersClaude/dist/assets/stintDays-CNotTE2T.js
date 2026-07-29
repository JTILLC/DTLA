const s=e=>[...e||[]].sort((t,r)=>new Date(t)-new Date(r));function a(e){const t=(e||"").trim();return t?/^\d{1,2}$/.test(t)?`Day ${t}`:t:""}export{a as f,s};
