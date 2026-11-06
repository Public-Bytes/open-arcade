import puppeteer from 'puppeteer-core';
import {writeFile} from 'node:fs/promises';

// Reproducible, cursor-free source footage for the bundled studio example.
const browser = await puppeteer.launch({executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true});
try {
  const page = await browser.newPage();
  await page.goto(process.env.STUDIO_URL || 'http://127.0.0.1:5173');
  const bytes = await page.evaluate(async () => {
    const {Output,BufferTarget,Mp4OutputFormat,CanvasSource,Quality} = await import('/node_modules/mediabunny/dist/modules/src/index.js');
    const c=document.createElement('canvas'); c.width=1280; c.height=800;
    const x=c.getContext('2d'); const target=new BufferTarget();
    const out=new Output({format:new Mp4OutputFormat(),target});
    const video=new CanvasSource(c,{codec:'avc',quality:new Quality({bitrate:2500000})});
    out.addVideoTrack(video,{frameRate:30}); await out.start();
    const text=(s,a,b,size=18,color='#243c32',weight=400)=>{x.font=`${weight} ${size}px Arial`; x.fillStyle=color;x.fillText(s,a,b);};
    const box=(a,b,w,h,color,r=12)=>{x.fillStyle=color;x.beginPath();x.roundRect(a,b,w,h,r);x.fill();};
    for(let i=0;i<240;i++) {
      const t=i/30, projects=t>=1.8;
      x.fillStyle='#f6f7f2';x.fillRect(0,0,1280,800);
      x.fillStyle='#e9eee6';x.fillRect(0,0,236,800);
      box(30,30,34,34,'#38634b',10);text('m',38,55,26,'#fff',700);text('meadow',77,56,25,'#294b38',600);
      text('WORKSPACE',32,116,10,'#748378',600);
      const nav=['Overview','Projects','Your team','Activity','Settings'];
      nav.forEach((n,j)=>{if(j===(projects?1:0))box(18,132+j*45,199,37,'#d4e2cb',8);text(['◈','▤','○','↗','⚙'][j],33,157+j*45,18);text(n,62,157+j*45,15);});
      box(20,677,196,99,'#d9e5d0',13);text('Good things take focus.',35,704,14,'#314a36',600);text('Make room for yours.',35,725,13,'#62715b');text('Your free workspace ↗',35,753,12);
      text('Workspace / '+(projects?'Projects':'Overview'),274,48,13,'#7d897e');text('J',1206,48,16,'#496a4c',600);
      text(projects?'Your next great idea':'A little more room to grow.',280,130,34,'#2a4135',600);
      text(projects?'Small beginnings. Meaningful work. All in one place.':'Everything you need for a thoughtful day of work.',280,162,16,'#7a8479');
      box(987,119,220,46,'#355d43',10);text('+ New project',1017,148,16,'#fff',600);
      const names=['Brand refresh','A calmer inbox','Website, reimagined'];
      for(let j=0;j<3;j++) {
        const a=280+j*314;box(a,211,294,326,'#fff');box(a+15,226,264,158,['#dfe9d3','#e7dfed','#f0dfce'][j]);
        x.save();x.translate(a+147,305);x.rotate(j*.4+t*.04);x.strokeStyle=['#7e9a68','#a697b5','#c19b77'][j];x.lineWidth=2;
        for(let k=0;k<5;k++){x.beginPath();x.ellipse(0,0,24+k*13,13+k*9,k*.43,0,Math.PI*2);x.stroke();}x.restore();
        text(names[j],a+22,422,19,'#334737',600);text('A space for ideas to find their feet.',a+22,452,13,'#85907f');box(a+22,482,83,25,'#edf3e7',12);text(['In progress','Planning','In review'][j],a+33,499,11,'#617451');
      }
      text('RECENT ACTIVITY',281,594,11,'#7d8b78',600);
      ['New ideas added to Brand refresh','Sam shared a moodboard','Website draft is ready for review'].forEach((s,j)=>{box(282,616+j*49,925,40,'#eff2eb',8);text(s,300,642+j*49,14,'#697862');text(['Just now','12 minutes ago','Today'][j],1090,642+j*49,11,'#8e978a');});
      if(t>=3.4){
        x.fillStyle='#20312445';x.fillRect(236,76,1044,724);
        box(430,248,526,321,'#fff',18);text('A new beginning',466,297,26,'#2d4335',600);text('Give your next project a home.',466,329,15,'#85917e');text('PROJECT NAME',466,373,10,'#7a8874',600);
        box(466,389,453,53,'#f4f6f0',8);x.strokeStyle=t>=5.2?'#6f945a':'#dde3d7';x.lineWidth=2;x.strokeRect(466,389,453,53);
        const name='Something wonderful'.slice(0,Math.max(0,Math.floor((t-5.2)*12)));text(name||'Untitled project',484,423,17,name?'#3a513c':'#a4ad9d');
        if(t>=5.2&&Math.floor(t*2)%2===0){x.fillStyle='#537746';x.fillRect(484+x.measureText(name).width+3,401,2,25);}
        text('Cancel',719,515,15,'#819078');box(792,483,128,49,'#355d43',9);text('Create project',809,514,14,'#fff',600);
      }
      await video.add(i/30,1/30);
    }
    video.close(); await out.finalize(); return Array.from(new Uint8Array(target.buffer));
  });
  await writeFile('public/example.mp4',Buffer.from(bytes));
  console.log(`Bundled example: ${bytes.length} bytes, 240 frames, 8 seconds.`);
} finally {await browser.close();}
