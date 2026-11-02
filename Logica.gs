/**
 * PDI · Escavador — regras de negócio (puras, sem dependência do Apps Script).
 * O MESMO código roda no servidor (Logica.gs) e no modo demonstração do Index.html.
 * Cada função recebe (db, emailDoUsuario, ...args). db = { usuarios, pdis, auto, acoes, hist, _dirty }.
 */
var PDI = (function () {

  var STATUS_ACAO = ['Não iniciado', 'Em andamento', 'Concluído', 'Cancelado'];
  var APROVACAO = ['Rascunho', 'Pendente', 'Aprovado', 'Reprovado'];
  var CAMPOS_NUCLEO = ['oque', 'como', 'suporte', 'inicio', 'prazo', 'indicador'];

  // ---------- utilitários ----------
  function low(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
  function str(s) { return s == null ? '' : String(s).trim(); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hoje() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function agora() { var d = new Date(); return hoje() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function novoId(p) { return p + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1296).toString(36).toUpperCase(); }
  function erro(msg) { throw new Error(msg); }
  function sujo(db, t) { db._dirty = db._dirty || {}; db._dirty[t] = true; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function num(x) { var n = parseFloat(x); return isNaN(n) ? 0 : n; }

  function usuario(db, email) { email = low(email); for (var i = 0; i < db.usuarios.length; i++) if (low(db.usuarios[i].email) === email) return db.usuarios[i]; return null; }
  function ativo(u) { return u && low(u.ativo) !== 'não' && low(u.ativo) !== 'nao' && low(u.ativo) !== 'false'; }
  function isRH(db, email) { var u = usuario(db, email); return !!u && low(u.perfil) === 'rh'; }
  function liderados(db, email) { email = low(email); return db.usuarios.filter(function (u) { return low(u.gestor) === email && ativo(u); }); }
  function isLider(db, email) { var u = usuario(db, email); return (!!u && low(u.perfil) === 'líder') || liderados(db, email).length > 0; }
  function pdiDe(db, email) { email = low(email); for (var i = 0; i < db.pdis.length; i++) if (low(db.pdis[i].email) === email) return db.pdis[i]; return null; }
  function pdiPorId(db, id) { for (var i = 0; i < db.pdis.length; i++) if (db.pdis[i].id === id) return db.pdis[i]; return null; }
  function acoesDe(db, pdiId) { return db.acoes.filter(function (a) { return a.pdiId === pdiId; }); }
  function acaoPorId(db, id) { for (var i = 0; i < db.acoes.length; i++) if (db.acoes[i].id === id) return db.acoes[i]; return null; }
  function nomeDe(db, email) { var u = usuario(db, email); return u ? (u.nome || u.email) : (email || ''); }

  function log(db, pdiId, acaoId, autor, evento, detalhe) {
    db.hist.push({ data: agora(), pdiId: pdiId, acaoId: acaoId || '', autor: autor, evento: evento, detalhe: detalhe || '' });
    sujo(db, 'hist');
  }

  function atrasada(a) { return !!a.prazo && a.prazo < hoje() && a.status !== 'Concluído' && a.status !== 'Cancelado'; }
  function progressoAcao(a) { return a.status === 'Concluído' ? 100 : Math.max(0, Math.min(100, num(a.progresso))); }

  // ---------- status consolidado ----------
  function resumoPDI(db, p) {
    var acs = acoesDe(db, p.id).filter(function (a) { return a.status !== 'Cancelado'; });
    var r = { total: acs.length, concluidas: 0, atrasadas: 0, pendentes: 0, reprovadas: 0, rascunho: 0, aprovadas: 0, progresso: 0 };
    var soma = 0;
    acs.forEach(function (a) {
      if (a.status === 'Concluído') r.concluidas++;
      if (atrasada(a)) r.atrasadas++;
      if (a.aprovacao === 'Pendente') r.pendentes++;
      if (a.aprovacao === 'Reprovado') r.reprovadas++;
      if (a.aprovacao === 'Rascunho') r.rascunho++;
      if (a.aprovacao === 'Aprovado') r.aprovadas++;
      soma += progressoAcao(a);
    });
    r.progresso = acs.length ? Math.round(soma / acs.length) : 0;
    if (!acs.length) r.status = 'Em elaboração';
    else if (r.concluidas === acs.length && r.aprovadas === acs.length) r.status = 'Concluído';
    else if (r.reprovadas) r.status = 'Ajustes solicitados';
    else if (r.pendentes) r.status = 'Aguardando aprovação';
    else if (r.rascunho) r.status = 'Em elaboração';
    else r.status = 'Em andamento';
    return r;
  }

  function linhaResumo(db, u) {
    var p = pdiDe(db, u.email);
    var base = { email: u.email, nome: u.nome || u.email, cargo: u.cargo || '', area: u.area || 'Sem área', gestor: u.gestor || '', gestorNome: u.gestor ? nomeDe(db, u.gestor) : '—', perfil: u.perfil || 'Colaborador' };
    if (!p) { base.temPDI = false; base.status = 'Sem PDI'; base.progresso = 0; base.total = 0; base.concluidas = 0; base.atrasadas = 0; base.pendentes = 0; base.reprovadas = 0; base.origem = ''; base.atualizadoEm = ''; base.fim = ''; return base; }
    var r = resumoPDI(db, p);
    for (var k in r) base[k] = r[k];
    base.temPDI = true; base.origem = p.origem; base.atualizadoEm = p.atualizadoEm; base.fim = p.fim; base.inicio = p.inicio;
    return base;
  }

  function pdiCompleto(db, email) {
    var p = pdiDe(db, email);
    if (!p) return null;
    var out = clone(p);
    var u = usuario(db, email) || {};
    out.gestorNome = p.gestor ? nomeDe(db, p.gestor) : '';
    out.area = u.area || '';
    out.auto = db.auto.filter(function (x) { return x.pdiId === p.id; }).sort(function (a, b) { return (a.tipo + a.ordem) < (b.tipo + b.ordem) ? -1 : 1; });
    out.acoes = acoesDe(db, p.id).map(function (a) { var c = clone(a); c.atrasada = atrasada(a); c.progresso = progressoAcao(a); c.avaliadoPorNome = a.avaliadoPor ? nomeDe(db, a.avaliadoPor) : ''; return c; });
    out.hist = db.hist.filter(function (h) { return h.pdiId === p.id; }).slice(-40).reverse().map(function (h) { var c = clone(h); c.autorNome = nomeDe(db, h.autor); return c; });
    out.resumo = resumoPDI(db, p);
    return out;
  }

  function podeVer(db, me, email) {
    if (low(me) === low(email)) return true;
    if (isRH(db, me)) return true;
    var u = usuario(db, email);
    return !!u && low(u.gestor) === low(me);
  }
  function podeEditar(db, me, email) { return low(me) === low(email) || isRH(db, me); }

  function garantirUsuario(db, me) {
    var u = usuario(db, me);
    if (!u) {
      u = { email: low(me), nome: low(me).split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }), cargo: '', area: '', gestor: '', perfil: 'Colaborador', ativo: 'Sim' };
      db.usuarios.push(u); sujo(db, 'usuarios');
    }
    return u;
  }

  function criarPDI(db, email, autor, origem) {
    var u = usuario(db, email) || {};
    var ini = hoje(), d = new Date(); d.setFullYear(d.getFullYear() + 1);
    var p = { id: novoId('P'), email: low(email), nome: u.nome || email, cargo: u.cargo || '', gestor: low(u.gestor || ''), inicio: ini, fim: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()), curtoPrazo: '', medioPrazo: '', origem: origem || 'Ferramenta', criadoEm: agora(), atualizadoEm: agora(), enviadoEm: '' };
    db.pdis.push(p); sujo(db, 'pdis');
    log(db, p.id, '', autor, 'PDI criado', origem === 'Excel' ? 'a partir de planilha Excel' : 'na ferramenta');
    return p;
  }

  function tocar(db, p) { p.atualizadoEm = agora(); sujo(db, 'pdis'); }

  function normAcao(a) {
    var st = STATUS_ACAO.indexOf(a.status) >= 0 ? a.status : 'Não iniciado';
    return { oque: str(a.oque), como: str(a.como), suporte: str(a.suporte), inicio: str(a.inicio), prazo: str(a.prazo), prazoTexto: str(a.prazoTexto), indicador: str(a.indicador), status: st, progresso: st === 'Concluído' ? 100 : Math.max(0, Math.min(100, Math.round(num(a.progresso)))), obs: str(a.obs) };
  }

  // ================= API =================
  var api = {};

  api.contexto = function (db, me) {
    var u = garantirUsuario(db, me);
    return { me: clone(u), isRH: isRH(db, me), isLider: isLider(db, me), temPDI: !!pdiDe(db, me), liderados: liderados(db, me).length, hoje: hoje() };
  };

  api.verPDI = function (db, me, email) {
    email = email || me;
    if (!podeVer(db, me, email)) erro('Você não tem acesso a este PDI.');
    var u = usuario(db, email);
    return { pdi: pdiCompleto(db, email), pessoa: u ? clone(u) : { email: email, nome: email }, gestorNome: u && u.gestor ? nomeDe(db, u.gestor) : '' };
  };

  api.iniciarPDI = function (db, me, email) {
    email = email || me;
    if (!podeEditar(db, me, email)) erro('Somente o próprio colaborador ou o RH podem criar este PDI.');
    if (!pdiDe(db, email)) criarPDI(db, email, me, 'Ferramenta');
    return api.verPDI(db, me, email);
  };

  // Identificação + Autoavaliação + Objetivos (campos parciais são mesclados)
  api.salvarCabecalho = function (db, me, dados) {
    var email = dados.email || me;
    if (!podeEditar(db, me, email)) erro('Somente o colaborador edita o próprio PDI.');
    var p = pdiDe(db, email) || criarPDI(db, email, me, 'Ferramenta');
    ['nome', 'cargo', 'inicio', 'fim', 'curtoPrazo', 'medioPrazo'].forEach(function (k) { if (dados[k] !== undefined) p[k] = str(dados[k]); });
    if (dados.inicio && dados.fim && dados.fim < dados.inicio) erro('O fim da validade precisa ser depois da data de início.');
    if (dados.auto) {
      db.auto = db.auto.filter(function (x) { return x.pdiId !== p.id; });
      dados.auto.forEach(function (x, i) {
        if (!str(x.titulo) && !str(x.descricao)) return;
        db.auto.push({ pdiId: p.id, tipo: x.tipo === 'Área de desenvolvimento' ? 'Área de desenvolvimento' : 'Ponto forte', ordem: String(x.ordem || i + 1), titulo: str(x.titulo), descricao: str(x.descricao) });
      });
      sujo(db, 'auto');
    }
    tocar(db, p);
    log(db, p.id, '', me, 'PDI atualizado', dados.secao || '');
    return api.verPDI(db, me, email);
  };

  api.salvarAcao = function (db, me, dados) {
    var email = dados.email || me;
    if (!podeEditar(db, me, email)) erro('Somente o colaborador edita o próprio plano de ação.');
    var p = pdiDe(db, email) || criarPDI(db, email, me, 'Ferramenta');
    var n = normAcao(dados);
    if (!n.oque) erro('Informe o que você vai desenvolver.');
    if (!n.prazo) erro('Informe o prazo da ação.');
    if (n.inicio && n.prazo < n.inicio) erro('O prazo precisa ser depois da data de início.');
    var a = dados.id ? acaoPorId(db, dados.id) : null;
    if (a) {
      if (a.pdiId !== p.id) erro('Ação não pertence a este PDI.');
      var mudouNucleo = CAMPOS_NUCLEO.some(function (k) { return str(a[k]) !== n[k]; });
      for (var k in n) a[k] = n[k];
      a.atualizadoEm = agora();
      if (mudouNucleo && a.aprovacao === 'Aprovado') { a.aprovacao = 'Pendente'; log(db, p.id, a.id, me, 'Ação alterada após aprovação', a.oque + ' · voltou para aprovação do líder'); }
      else if (mudouNucleo && a.aprovacao === 'Reprovado') { a.aprovacao = 'Rascunho'; log(db, p.id, a.id, me, 'Ação ajustada', a.oque + ' · pronta para reenviar'); }
      else log(db, p.id, a.id, me, 'Ação editada', a.oque);
    } else {
      a = n; a.id = novoId('A'); a.pdiId = p.id; a.aprovacao = 'Rascunho'; a.obsLider = ''; a.avaliadoPor = ''; a.avaliadoEm = ''; a.criadoEm = agora(); a.atualizadoEm = agora();
      db.acoes.push(a);
      log(db, p.id, a.id, me, 'Ação criada', a.oque);
    }
    sujo(db, 'acoes'); tocar(db, p);
    return api.verPDI(db, me, email);
  };

  api.atualizarAndamento = function (db, me, acaoId, dados) {
    var a = acaoPorId(db, acaoId) || erro('Ação não encontrada.');
    var p = pdiPorId(db, a.pdiId);
    if (!podeEditar(db, me, p.email)) erro('Somente o colaborador atualiza o andamento.');
    var antes = a.status + ' ' + progressoAcao(a) + '%';
    if (dados.status && STATUS_ACAO.indexOf(dados.status) >= 0) a.status = dados.status;
    if (dados.progresso !== undefined) a.progresso = Math.max(0, Math.min(100, Math.round(num(dados.progresso))));
    if (a.status === 'Concluído') a.progresso = 100;
    if (dados.obs !== undefined) a.obs = str(dados.obs);
    a.atualizadoEm = agora();
    sujo(db, 'acoes'); tocar(db, p);
    log(db, p.id, a.id, me, 'Andamento atualizado', a.oque + ' · ' + antes + ' → ' + a.status + ' ' + progressoAcao(a) + '%' + (str(dados.nota) ? ' · "' + str(dados.nota) + '"' : ''));
    return api.verPDI(db, me, p.email);
  };

  api.excluirAcao = function (db, me, acaoId) {
    var a = acaoPorId(db, acaoId) || erro('Ação não encontrada.');
    var p = pdiPorId(db, a.pdiId);
    if (!podeEditar(db, me, p.email)) erro('Sem permissão.');
    if (a.aprovacao === 'Aprovado' && !isRH(db, me)) erro('Ação já aprovada pelo líder: marque como Cancelada em vez de excluir.');
    db.acoes = db.acoes.filter(function (x) { return x.id !== acaoId; });
    sujo(db, 'acoes'); tocar(db, p);
    log(db, p.id, '', me, 'Ação excluída', a.oque);
    return api.verPDI(db, me, p.email);
  };

  api.enviarAprovacao = function (db, me, email) {
    email = email || me;
    if (!podeEditar(db, me, email)) erro('Sem permissão.');
    var p = pdiDe(db, email) || erro('PDI não encontrado.');
    var u = usuario(db, email) || {};
    if (!u.gestor) erro('Seu cadastro não tem gestor imediato. Peça ao RH para incluir antes de enviar.');
    p.gestor = low(u.gestor);
    var n = 0;
    acoesDe(db, p.id).forEach(function (a) { if (a.aprovacao === 'Rascunho') { a.aprovacao = 'Pendente'; a.atualizadoEm = agora(); n++; } });
    if (!n) erro('Não há ações em rascunho para enviar.');
    p.enviadoEm = agora();
    sujo(db, 'acoes'); tocar(db, p);
    log(db, p.id, '', me, 'Enviado para aprovação', n + (n > 1 ? ' ações' : ' ação') + ' para ' + nomeDe(db, u.gestor));
    return api.verPDI(db, me, email);
  };

  // ---------- Líder ----------
  api.meuTime = function (db, me) {
    return liderados(db, me).map(function (u) { return linhaResumo(db, u); }).sort(function (a, b) { return b.pendentes - a.pendentes || a.nome.localeCompare(b.nome); });
  };

  api.avaliarAcao = function (db, me, acaoId, decisao, obs) {
    var a = acaoPorId(db, acaoId) || erro('Ação não encontrada.');
    var p = pdiPorId(db, a.pdiId);
    var u = usuario(db, p.email) || {};
    if (low(u.gestor) !== low(me)) erro('Somente o gestor imediato aprova ou reprova as ações.');
    if (a.aprovacao !== 'Pendente') erro('Esta ação não está aguardando aprovação.');
    if (decisao !== 'Aprovado' && decisao !== 'Reprovado') erro('Decisão inválida.');
    if (decisao === 'Reprovado' && !str(obs)) erro('Ao reprovar, descreva o que precisa ter neste plano de ação.');
    a.aprovacao = decisao; a.obsLider = str(obs); a.avaliadoPor = low(me); a.avaliadoEm = agora(); a.atualizadoEm = agora();
    sujo(db, 'acoes'); tocar(db, p);
    log(db, p.id, a.id, me, decisao === 'Aprovado' ? 'Ação aprovada' : 'Ação reprovada', a.oque + (str(obs) ? ' · "' + str(obs) + '"' : ''));
    return api.verPDI(db, me, p.email);
  };

  // ---------- RH ----------
  function exigirRH(db, me) { if (!isRH(db, me)) erro('Área exclusiva do RH.'); }

  api.painelRH = function (db, me) {
    exigirRH(db, me);
    var linhas = db.usuarios.filter(ativo).map(function (u) { return linhaResumo(db, u); });
    var k = { colaboradores: linhas.length, comPDI: 0, semPDI: 0, concluidos: 0, aguardando: 0, ajustes: 0, acoes: 0, acoesConcluidas: 0, atrasadas: 0, excel: 0, ferramenta: 0, progressoMedio: 0 };
    var porStatus = {}, porArea = {}, soma = 0;
    linhas.forEach(function (l) {
      porStatus[l.status] = (porStatus[l.status] || 0) + 1;
      var ar = porArea[l.area] || (porArea[l.area] = { area: l.area, colaboradores: 0, comPDI: 0, concluidos: 0, somaProg: 0, atrasadas: 0 });
      ar.colaboradores++;
      if (l.temPDI) {
        k.comPDI++; ar.comPDI++; soma += l.progresso; ar.somaProg += l.progresso; ar.atrasadas += l.atrasadas;
        if (l.origem === 'Excel') k.excel++; else k.ferramenta++;
      } else k.semPDI++;
      if (l.status === 'Concluído') { k.concluidos++; ar.concluidos++; }
      if (l.status === 'Aguardando aprovação') k.aguardando++;
      if (l.status === 'Ajustes solicitados') k.ajustes++;
      k.acoes += l.total; k.acoesConcluidas += l.concluidas; k.atrasadas += l.atrasadas;
    });
    k.progressoMedio = k.comPDI ? Math.round(soma / k.comPDI) : 0;
    var areas = Object.keys(porArea).map(function (a) { var x = porArea[a]; x.progressoMedio = x.comPDI ? Math.round(x.somaProg / x.comPDI) : 0; delete x.somaProg; return x; }).sort(function (a, b) { return a.area.localeCompare(b.area); });
    return { kpis: k, porStatus: porStatus, areas: areas, linhas: linhas.sort(function (a, b) { return a.nome.localeCompare(b.nome); }), geradoEm: agora() };
  };

  api.colaboradores = function (db, me) {
    exigirRH(db, me);
    return db.usuarios.map(function (u) { var c = clone(u); c.gestorNome = u.gestor ? nomeDe(db, u.gestor) : ''; c.temPDI = !!pdiDe(db, u.email); return c; }).sort(function (a, b) { return String(a.nome).localeCompare(String(b.nome)); });
  };

  // lista leve (nome/e-mail) para seletores — RH vê todos
  api.listaPessoas = function (db, me) {
    exigirRH(db, me);
    return db.usuarios.filter(ativo).map(function (u) { return { email: u.email, nome: u.nome, cargo: u.cargo, temPDI: !!pdiDe(db, u.email) }; }).sort(function (a, b) { return String(a.nome).localeCompare(String(b.nome)); });
  };

  function upsertUsuario(db, d) {
    var email = low(d.email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) erro('E-mail inválido: ' + (d.email || '(vazio)'));
    var perfil = /^rh$/i.test(str(d.perfil)) ? 'RH' : (/^l[ií]der/i.test(str(d.perfil)) ? 'Líder' : 'Colaborador');
    var u = usuario(db, email), novo = !u;
    if (!u) { u = { email: email }; db.usuarios.push(u); }
    u.nome = str(d.nome) || u.nome || email; u.cargo = str(d.cargo); u.area = str(d.area); u.gestor = low(d.gestor); u.perfil = perfil;
    u.ativo = (d.ativo === false || /^n[ãa]o$/i.test(str(d.ativo))) ? 'Não' : 'Sim';
    if (u.gestor === email) erro(u.nome + ': o gestor não pode ser a própria pessoa.');
    var p = pdiDe(db, email); if (p) { p.gestor = u.gestor; if (!p.cargo) p.cargo = u.cargo; sujo(db, 'pdis'); }
    sujo(db, 'usuarios');
    return novo;
  }

  api.salvarColaborador = function (db, me, d) {
    exigirRH(db, me);
    if (d.emailOriginal && low(d.emailOriginal) !== low(d.email)) erro('Para trocar o e-mail, cadastre a pessoa de novo e desative o cadastro antigo.');
    upsertUsuario(db, d);
    return api.colaboradores(db, me);
  };

  api.importarColaboradores = function (db, me, lista) {
    exigirRH(db, me);
    var novos = 0, atualizados = 0, erros = [];
    (lista || []).forEach(function (d, i) {
      try { if (upsertUsuario(db, d)) novos++; else atualizados++; }
      catch (e) { erros.push('Linha ' + (i + 2) + ': ' + e.message); }
    });
    return { novos: novos, atualizados: atualizados, erros: erros, lista: api.colaboradores(db, me) };
  };

  // ---------- Importação de Excel (modelo PDI.xlsx) ----------
  // payload: { email, ident:{nome,cargo,inicio,fim}, auto:[], curtoPrazo, medioPrazo, acoes:[], modo:'substituir'|'adicionar', enviar:bool }
  api.importarExcel = function (db, me, d) {
    var email = low(d.email || me);
    if (!podeEditar(db, me, email)) erro('Você só pode importar o seu próprio PDI.');
    if (!usuario(db, email)) erro('Colaborador não cadastrado: ' + email);
    var p = pdiDe(db, email);
    if (!p) p = criarPDI(db, email, me, 'Excel');
    else {
      p.origem = 'Excel';
      if (d.modo === 'substituir') {
        var aprovadas = acoesDe(db, p.id).filter(function (a) { return a.aprovacao === 'Aprovado'; }).length;
        if (aprovadas && !d.confirmarAprovadas) erro('Este PDI tem ' + aprovadas + ' ação(ões) já aprovadas pelo líder. Confirme a substituição para continuar.');
        db.acoes = db.acoes.filter(function (a) { return a.pdiId !== p.id; });
      }
    }
    var id = d.ident || {};
    ['nome', 'cargo', 'inicio', 'fim'].forEach(function (k) { if (str(id[k])) p[k] = str(id[k]); });
    if (str(d.curtoPrazo)) p.curtoPrazo = str(d.curtoPrazo);
    if (str(d.medioPrazo)) p.medioPrazo = str(d.medioPrazo);
    if (d.auto && d.auto.length) {
      db.auto = db.auto.filter(function (x) { return x.pdiId !== p.id; });
      d.auto.forEach(function (x, i) { if (str(x.titulo) || str(x.descricao)) db.auto.push({ pdiId: p.id, tipo: x.tipo, ordem: String(x.ordem || i + 1), titulo: str(x.titulo), descricao: str(x.descricao) }); });
      sujo(db, 'auto');
    }
    var u = usuario(db, email); p.gestor = low(u.gestor || '');
    var envia = !!d.enviar && !!u.gestor, n = 0;
    (d.acoes || []).forEach(function (x) {
      var a = normAcao(x); if (!a.oque) return;
      a.id = novoId('A'); a.pdiId = p.id; a.aprovacao = envia ? 'Pendente' : 'Rascunho'; a.obsLider = ''; a.avaliadoPor = ''; a.avaliadoEm = ''; a.criadoEm = agora(); a.atualizadoEm = agora();
      db.acoes.push(a); n++;
    });
    if (envia && n) p.enviadoEm = agora();
    sujo(db, 'acoes'); tocar(db, p);
    log(db, p.id, '', me, 'Excel importado', n + ' ação(ões) · modo ' + (d.modo || 'substituir') + (envia ? ' · enviado para aprovação' : '') + (d.arquivo ? ' · ' + d.arquivo : ''));
    return api.verPDI(db, me, email);
  };

  api._status = { acao: STATUS_ACAO, aprovacao: APROVACAO };
  return api;
})();
