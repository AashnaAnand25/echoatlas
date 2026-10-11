(() => {
  const root = document.documentElement;
  const byId = id => document.getElementById(id);
  const labels = {
    en: ['Overview','Case Library','Practice Lab','AI Learning Guide','Ultrasound Workspace','Probe Simulator','Classification','Explainability','History / Reports','Sources & Ethics','Settings'],
    es: ['Inicio','Biblioteca de casos','Práctica','Guía de aprendizaje con IA','Visor de ecografía','Simulador de sonda','Clasificación','Explicaciones','Historial / Informes','Fuentes y ética','Ajustes'],
    ko: ['개요','사례 라이브러리','연습실','AI 학습 가이드','초음파 작업 공간','프로브 시뮬레이터','분류','설명','기록 / 보고서','출처 및 윤리','설정'],
    hi: ['अवलोकन','केस लाइब्रेरी','अभ्यास','AI शिक्षण गाइड','अल्ट्रासाउंड कार्यक्षेत्र','प्रोब सिम्युलेटर','वर्गीकरण','व्याख्या','इतिहास / रिपोर्ट','स्रोत और नैतिकता','सेटिंग्स']
  };
  const tabs = ['overview','library','practice','chat','workspace','simulator','classification','explainability','history','sources','settings'];
  const settingsLabels = {
    en:['Make yourself comfortable','Appearance','Text size','Reduce motion','Language','Reset settings','Saved'],
    es:['Hazlo más cómodo','Apariencia','Tamaño del texto','Reducir movimiento','Idioma','Restablecer ajustes','Guardado'],
    ko:['편하게 사용하세요','화면 모드','글자 크기','움직임 줄이기','언어','설정 초기화','저장됨'],
    hi:['अपनी सुविधा चुनें','दिखावट','अक्षर आकार','गति कम करें','भाषा','सेटिंग्स रीसेट करें','सहेजा गया']
  };
  const ids=['settingsTitle','settingThemeLabel','settingTextLabel','settingMotionLabel','settingLanguageLabel','resetAccessibility','settingsSaved'];
  function apply() {
    const size = localStorage.getItem('echoatlas_text_size') || '100';
    root.style.fontSize = `${Number(size)}%`;
    byId('settingText').value=size;
    const motion = localStorage.getItem('echoatlas_reduce_motion');
    const reduced = motion === null ? matchMedia('(prefers-reduced-motion: reduce)').matches : motion === 'true';
    root.dataset.reduceMotion = String(reduced);
    byId('settingMotion').checked=reduced;
    const language=localStorage.getItem('echoatlas_language') || 'en';
    byId('settingLanguage').value=labels[language] ? language : 'en';
    const translated=labels[language] || labels.en;
    tabs.forEach((tab,i)=>{
      const button=document.querySelector(`.sidebar-item[data-tab="${tab}"]`);
      if(button) { button.querySelector('span:last-child').textContent=translated[i]; button.setAttribute('aria-label',translated[i]); button.lang=language; }
    });
    ids.forEach((id,i)=> { byId(id).textContent=(settingsLabels[language] || settingsLabels.en)[i]; byId(id).lang=language; });
    byId('settingTheme').value=root.getAttribute('data-theme')==='light'?'light':'dark';
  }
  byId('settingTheme').addEventListener('change',event=>{
    const theme=event.target.value;
    if((root.getAttribute('data-theme')==='light'?'light':'dark')!==theme) byId('themeToggleBtn').click();
    apply();
  });
  byId('themeToggleBtn').addEventListener('click',()=>{ byId('settingTheme').value=root.getAttribute('data-theme')==='light'?'light':'dark'; });
  [['settingText','echoatlas_text_size'],['settingMotion','echoatlas_reduce_motion'],['settingLanguage','echoatlas_language']].forEach(([id,key])=>{
    byId(id).addEventListener('change',event=>{localStorage.setItem(key,id==='settingMotion'?String(event.target.checked):event.target.value);apply();});
  });
  byId('resetAccessibility').addEventListener('click',()=>{
    ['echoatlas_text_size','echoatlas_reduce_motion','echoatlas_language'].forEach(key=>localStorage.removeItem(key));
    if(root.getAttribute('data-theme')==='light') byId('themeToggleBtn').click();
    apply();
  });
  apply();
})();
