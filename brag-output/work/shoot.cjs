const {chromium}=require('/tmp/claude-1000/-home-kanyanta-Projects-ai-tutor/c408b6d0-6494-4bd0-91bd-b08b730b43d3/scratchpad/pw/node_modules/playwright');
(async()=>{
 const b=await chromium.launch({executablePath:'/usr/bin/google-chrome-stable',args:['--no-sandbox']});const p=await b.newPage({viewport:{width:1920,height:1080}});
 await p.goto('file://'+process.cwd()+'/index.html');await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(1500);
 const args=process.argv.slice(2);
 const fs=require('fs');fs.mkdirSync('frames',{recursive:true});
 if(args[0]==='stills'){for(const t of args.slice(1)){await p.evaluate(t=>window.renderAt(t),+t);await p.screenshot({path:'still_'+t+'.png'});}}
 else{for(let i=0;i<600;i++){await p.evaluate(t=>window.renderAt(t),i/30);await p.screenshot({path:'frames/f'+String(i).padStart(4,'0')+'.jpg',type:'jpeg',quality:92});}}
 await b.close();})();
