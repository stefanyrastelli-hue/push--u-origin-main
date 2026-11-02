/**
 * PDI · Escavador — servidor (Google Apps Script, vinculado à planilha).
 * Arquivos do projeto: Codigo.gs (este), Logica.gs (regras), Index.html (interface).
 * Implantação: Executar como "Eu" · Acesso "Qualquer pessoa no domínio".
 */

var BUILD = 'PDI · BUILD 1 · 02/11/2026';

// Abas e colunas (a ordem das colunas é a ordem gravada na planilha)
var ABAS = {
  usuarios: { nome: 'Colaboradores', cols: [['email', 'E-mail'], ['nome', 'Nome'], ['cargo', 'Cargo'], ['area', 'Área/Time'], ['gestor', 'Gestor (e-mail)'], ['perfil', 'Perfil'], ['ativo', 'Ativo']] },
  pdis: { nome: 'PDIs', cols: [['id', 'ID PDI'], ['email', 'E-mail colaborador'], ['nome', 'Nome do colaborador'], ['cargo', 'Cargo'], ['gestor', 'Gestor imediato (e-mail)'], ['inicio', 'Data de início'], ['fim', 'Validade até'], ['curtoPrazo', 'Objetivo curto prazo (6m-1a)'], ['medioPrazo', 'Objetivo médio prazo (2-3a)'], ['origem', 'Origem'], ['criadoEm', 'Criado em'], ['atualizadoEm', 'Atualizado em'], ['enviadoEm', 'Enviado p/ aprovação em']] },
  auto: { nome: 'Autoavaliação', cols: [['pdiId', 'ID PDI'], ['tipo', 'Tipo'], ['ordem', 'Ordem'], ['titulo', 'Ponto forte / Área'], ['descricao', 'Como se manifesta / Por que é importante']] },
  acoes: { nome: 'Plano de Ação', cols: [['id', 'ID Ação'], ['pdiId', 'ID PDI'], ['oque', 'O que desenvolver?'], ['como', 'Como? (Ações e Recursos)'], ['suporte', 'Suporte do Gestor'], ['inicio', 'Data de início'], ['prazo', 'Prazo (data)'], ['prazoTexto', 'Prazo (texto original)'], ['indicador', 'Indicador de Sucesso'], ['status', 'Status'], ['progresso', 'Progresso %'], ['obs', 'Observações'], ['aprovacao', 'Aprovação'], ['obsLider', 'Observação do líder'], ['avaliadoPor', 'Avaliado por'], ['avaliadoEm', 'Avaliado em'], ['criadoEm', 'Criado em'], ['atualizadoEm', 'Atualizado em']] },
  hist: { nome: 'Histórico', cols: [['data', 'Data'], ['pdiId', 'ID PDI'], ['acaoId', 'ID Ação'], ['autor', 'Autor'], ['evento', 'Evento'], ['detalhe', 'Detalhe']] }
};

// Funções da Logica liberadas para o front
var LEITURA = ['contexto', 'verPDI', 'meuTime', 'painelRH', 'colaboradores', 'listaPessoas'];
var ESCRITA = ['iniciarPDI', 'salvarCabecalho', 'salvarAcao', 'atualizarAndamento', 'excluirAcao', 'enviarAprovacao', 'avaliarAcao', 'salvarColaborador', 'importarColaboradores', 'importarExcel'];

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('PDI · Escavador')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('PDI')
    .addItem('Configurar planilha (1ª vez)', 'configurar')
    .addItem('Abrir o app', 'abrirApp')
    .addToUi();
}

function abrirApp() {
  var url = ScriptApp.getService().getUrl();
  var html = HtmlService.createHtmlOutput(url
    ? '<p style="font-family:sans-serif">Abra o app: <a target="_blank" href="' + url + '">' + url + '</a></p>'
    : '<p style="font-family:sans-serif">Implante primeiro: Implantar → Nova implantação → App da Web.</p>').setWidth(460).setHeight(120);
  SpreadsheetApp.getUi().showModalDialog(html, 'PDI · Escavador');
}

/** Cria as abas (se não existirem) e cadastra quem executou como RH. */
function configurar() {
  var ss = SpreadsheetApp.getActive();
  Object.keys(ABAS).forEach(function (k) {
    var a = ABAS[k], sh = ss.getSheetByName(a.nome);
    if (!sh) sh = ss.insertSheet(a.nome);
    var head = a.cols.map(function (c) { return c[1]; });
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#1A1A1A').setFontColor('#FFD700');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), head.length).setNumberFormat('@'); // tudo texto: datas ISO não viram Date
  });
  var me = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  var db = carregar_();
  if (me && !db.usuarios.some(function (u) { return String(u.email).toLowerCase() === me; })) {
    db.usuarios.push({ email: me, nome: me.split('@')[0], cargo: '', area: 'RH', gestor: '', perfil: 'RH', ativo: 'Sim' });
    db._dirty = { usuarios: true };
    salvar_(db);
  }
  try { SpreadsheetApp.getUi().alert('Planilha pronta. Cadastre os colaboradores na aba "Colaboradores" (ou pelo app, tela Colaboradores) e implante o App da Web.'); } catch (e) {}
}

/** Endpoint único chamado pelo front: api('salvarAcao', [dados]) */
function api(fn, args) {
  var escrita = ESCRITA.indexOf(fn) >= 0;
  if (!escrita && LEITURA.indexOf(fn) < 0) throw new Error('Operação desconhecida: ' + fn);
  var me = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!me) throw new Error('Não foi possível identificar seu e-mail Google. Acesse com a conta @escavador e, se estiver logado em várias contas, use uma janela anônima.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var db = carregar_();
    var res = PDI[fn].apply(null, [db, me].concat(args || []));
    if (db._dirty) salvar_(db);
    if (fn === 'contexto') res.build = BUILD;
    return JSON.parse(JSON.stringify(res));
  } finally {
    lock.releaseLock();
  }
}

function carregar_() {
  var ss = SpreadsheetApp.getActive(), tz = ss.getSpreadsheetTimeZone(), db = { _dirty: null };
  Object.keys(ABAS).forEach(function (k) {
    var a = ABAS[k], sh = ss.getSheetByName(a.nome), out = [];
    if (sh && sh.getLastRow() > 1) {
      var vals = sh.getRange(2, 1, sh.getLastRow() - 1, a.cols.length).getValues();
      vals.forEach(function (r) {
        if (r.join('') === '') return;
        var o = {};
        a.cols.forEach(function (c, i) {
          var v = r[i];
          o[c[0]] = v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : String(v == null ? '' : v);
        });
        out.push(o);
      });
    }
    db[k] = out;
  });
  return db;
}

function salvar_(db) {
  var ss = SpreadsheetApp.getActive();
  Object.keys(db._dirty || {}).forEach(function (k) {
    var a = ABAS[k]; if (!a) return;
    var sh = ss.getSheetByName(a.nome);
    if (!sh) { configurar(); sh = ss.getSheetByName(a.nome); }
    var n = sh.getLastRow();
    if (n > 1) sh.getRange(2, 1, n - 1, a.cols.length).clearContent();
    var rows = db[k].map(function (o) { return a.cols.map(function (c) { return o[c[0]] == null ? '' : String(o[c[0]]); }); });
    if (rows.length) sh.getRange(2, 1, rows.length, a.cols.length).setNumberFormat('@').setValues(rows);
  });
}
