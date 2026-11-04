document.getElementById('loginForm').addEventListener('submit',async event=>{
  event.preventDefault();
  const username=document.getElementById('username').value.trim(), password=document.getElementById('password').value;
  const error=document.getElementById('err'),button=document.getElementById('loginBtn');error.textContent='';
  if(!username||!password){error.textContent='Введите логин и пароль';return}
  button.disabled=true;
  try{
    const role=document.body.dataset.authRole==='admin'?'admin':'host';
    const response=await fetch(`/api/${role}/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
    const data=await response.json();
    if(!response.ok){error.textContent=data.error||'Не удалось войти';return}
    location.href=role==='admin'?'/admin.html':'/games.html';
  }catch{error.textContent='Нет связи с сервером. Попробуйте ещё раз.'}finally{button.disabled=false}
});
