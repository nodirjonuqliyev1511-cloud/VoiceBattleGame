// Team selection is separate from microphone sampling and recording.
window.createTeamChooser = function ({socket}) {
  const $=id=>document.getElementById(id);
  let mode=new URLSearchParams(location.search).get('game')==='baby'?'baby':'race';
  let selected=null, available=['boy','girl'], ready=false, joined=false, pending=false, status='lobby';
  const code=()=>$('roomInput').value.trim().toUpperCase();
  const teamName=side=>side==='girl'?'Команда «Девочка»':'Команда «Мальчик»';
  $('teamBoyArt').innerHTML=NurseryArt.baby('boy');
  $('teamGirlArt').innerHTML=NurseryArt.baby('girl');
  function render(){
    const baby=mode==='baby';
    $('nameInput').hidden=baby;
    $('teamChoice').hidden=!baby;
    $('joinDescription').textContent=baby?'Какую версию поддерживает ваша команда?':'Введи код комнаты и своё имя';
    $('joinBtn').textContent=baby?'Подключить команду':'ПРИСОЕДИНИТЬСЯ';
    $('joinBtn').disabled=pending||(baby&&(!ready||!selected||status!=='lobby'||!available.includes(selected)));
    document.body.classList.toggle('baby-controller',baby);
    if(baby){
      $('joinLogo').innerHTML='<span class="cyan">'+PlatformBrand.babyFirstLine+'</span><br><span class="hot" style="font-size:.65em">'+PlatformBrand.babySecondLine+'</span>';
      document.title=PlatformBrand.babyName+' — команды';
    }else{$('joinLogo').textContent=PlatformBrand.name;document.title=PlatformBrand.name+' — участник';}
    for(const side of ['boy','girl']){
      const button=$(side==='boy'?'chooseBoy':'chooseGirl');
      const free=available.includes(side);
      button.disabled=!ready||!free||status!=='lobby'||pending;
      button.classList.toggle('selected',selected===side&&free);
      button.setAttribute('aria-pressed',String(selected===side&&free));
      $(side==='boy'?'boyAvailability':'girlAvailability').textContent=!ready?'Проверяем комнату…':!free?'Телефон уже подключён':selected===side?'Ваша команда':'Выбрать команду';
    }
    $('teamChoiceHint').textContent=!ready?'Введите код комнаты или отсканируйте QR ведущего.':status!=='lobby'?'Раунд уже начался. Дождитесь следующего.':available.length===0?'Оба телефона уже подключены.':available.length===1?'Осталась '+teamName(available[0]).toLowerCase()+'. Сторона выбрана автоматически.':'Выберите сторону. Каждая команда кричит в один свой телефон.';
  }
  function watch(){if(joined)return;const roomCode=code();if(roomCode.length===6)socket.emit('watchRoom',{roomCode});}
  for(const side of ['boy','girl'])$(side==='boy'?'chooseBoy':'chooseGirl').addEventListener('click',()=>{
    if(!ready||pending||status!=='lobby'||!available.includes(side))return;
    selected=side;$('errorText').textContent='';render();
  });
  $('roomInput').addEventListener('input',()=>{
    if(joined)return;ready=false;available=['boy','girl'];selected=null;status='lobby';$('errorText').textContent='';render();watch();
  });
  socket.on('roomInfo',info=>{
    if(info.roomCode!==code()||joined)return;
    mode=info.gameMode;status=info.status;ready=true;
    available=Array.isArray(info.availableSides)?info.availableSides:[];
    if(mode==='baby'){
      if(available.length===1)selected=available[0];
      else if(!available.includes(selected))selected=null;
    }
    render();
  });
  socket.on('roomInfoError',info=>{if(info.roomCode!==code()||joined)return;ready=false;render();$('errorText').textContent=info.message;});
  socket.on('roomClosed',info=>{if(info.roomCode!==code()||joined)return;ready=false;render();$('errorText').textContent='Ведущий закрыл комнату. Получите новый QR-код.';});
  socket.on('connect',watch);
  render();if(socket.connected)watch();
  return {
    get mode(){return mode},get side(){return selected},
    canJoin(){return mode!=='baby'||(ready&&status==='lobby'&&available.includes(selected))},
    setPending(value){pending=value;render()},
    joined(){joined=true;pending=false},
    failed(){pending=false;render();watch()},
    left(){joined=false;pending=false;ready=false;selected=null;render()}
  };
};
