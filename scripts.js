// script.js - cliente simple
async function api(path, opts){
  const res = await fetch(path, Object.assign({ credentials:'same-origin', headers:{'Content-Type':'application/json'} }, opts));
  return res.json();
}

async function scriptLoadMeAndVehicles(){
  const me = await api('/api/me');
  const userArea = document.getElementById('user-area');
  if (!me.ok || !me.logged) {
    userArea.innerHTML = '<a class="btn" href="/auth/discord">Iniciar con Discord</a>';
    document.getElementById('vehicles-list').innerHTML = '<p class="note">No estás autenticado.</p>';
    return;
  }
  userArea.innerHTML = `<div class="small">Conectado: <b>${me.user.username}#${me.user.discriminator}</b> ${me.isModerator ? '(moderador)' : ''}</div>`;
  // cargar vehículos propios
  const r = await api('/api/vehicles');
  if (!r.ok) {
    document.getElementById('vehicles-list').innerHTML = '<p class="note">Error al cargar vehículos.</p>';
    return;
  }
  const list = r.vehicles;
  if (!list.length) {
    document.getElementById('vehicles-list').innerHTML = '<p class="note">No tienes vehículos registrados.</p>';
    return;
  }
  document.getElementById('vehicles-list').innerHTML = list.map(v => `
    <div class="vehicle">
      <div>
        <div><b>${v.plate}</b> — <span class="small">${v.model||''} ${v.color?'- ' + v.color : ''}</span></div>
        <div class="small">Notas: ${v.notes||'-'}</div>
        <div class="small">Registrado: ${new Date(v.created_at).toLocaleString()}</div>
      </div>
    </div>
  `).join('');
}

async function scriptLoadMeAndAllVehicles(){
  const me = await api('/api/me');
  const userArea = document.getElementById('user-area');
  if (!me.ok || !me.logged) {
    userArea.innerHTML = '<a class="btn" href="/auth/discord">Iniciar con Discord</a>';
    document.getElementById('all-vehicles').innerHTML = '<p class="note">No estás autenticado.</p>';
    return;
  }
  if (!me.isModerator) {
    document.getElementById('all-vehicles').innerHTML = '<p class="note">No eres moderador.</p>';
    userArea.innerHTML = `<div class="small">Conectado: <b>${me.user.username}#${me.user.discriminator}</b></div>`;
    return;
  }
  userArea.innerHTML = `<div class="small">Conectado: <b>${me.user.username}#${me.user.discriminator}</b> (moderador)</div>`;

  // bind search
  document.getElementById('btn-search-user').addEventListener('click', async ()=>{
    const q = document.getElementById('search-user').value.trim();
    if (!q) return;
    const res = await api('/api/user/search?q=' + encodeURIComponent(q));
    const out = (res.results || []).map(r => `<div class="small"> ${r.username}#${r.discriminator} — <button onclick="selectUser('${r.discord_id}')">Seleccionar</button></div>`).join('');
    document.getElementById('search-results').innerHTML = out || '<div class="note">No resultados</div>';
  });
  window.selectUser = function(id){
    document.getElementById('target-discord-id').value = id;
  };

  document.getElementById('btn-register-vehicle').addEventListener('click', async ()=>{
    const discord_id = (document.getElementById('target-discord-id').value || '').trim();
    const plate = (document.getElementById('v-plate').value || '').trim();
    if (!discord_id || !plate) return alert('Discord ID y placa son obligatorios');
    const payload = {
      discord_id,
      plate,
      model: document.getElementById('v-model').value.trim(),
      color: document.getElementById('v-color').value.trim(),
      notes: document.getElementById('v-notes').value.trim()
    };
    const r = await api('/api/admin/vehicles', { method:'POST', body: JSON.stringify(payload) });
    if (!r.ok) return alert('Error: ' + (r.error || ''));
    alert('Vehículo registrado');
    loadAllVehicles();
  });

  window.deleteVehicle = async function(id){
    if (!confirm('Eliminar vehículo #' + id + ' ?')) return;
    const r = await api('/api/admin/vehicles/' + id, { method:'DELETE' });
    if (!r.ok) return alert('Error');
    loadAllVehicles();
  };

  async function loadAllVehicles(){
    const r = await api('/api/admin/vehicles');
    if (!r.ok) return document.getElementById('all-vehicles').innerHTML = '<p class="note">Error</p>';
    document.getElementById('all-vehicles').innerHTML = r.vehicles.map(v => `
      <div class="vehicle">
        <div>
          <div><b>${v.plate}</b> — <span class="small">${v.model||''} ${v.color?'- ' + v.color : ''}</span></div>
          <div class="small">Usuario: ${v.discord_id} — Registrado: ${new Date(v.created_at).toLocaleString()}</div>
          <div class="small">Notas: ${v.notes||'-'}</div>
        </div>
        <div>
          <button class="btn-danger" onclick="deleteVehicle(${v.id})">Eliminar vehículo</button>
        </div>
      </div>
    `).join('');
  }

  // inicial
  loadAllVehicles();
}