const fs = require('fs');

const EMAIL_DESTINO = process.env.EMAIL_DESTINO;
const EMAIL_REMETENTE = process.env.EMAIL_REMETENTE;
const EMAIL_SENHA = process.env.EMAIL_SENHA;
const ARQUIVO_ESTADO = 'estado.json';
const API_BASE = 'https://sapl.al.pi.leg.br/api';
const CASA_NOME = 'Assembleia Legislativa do Piauí';
const MATERIA_BASE = 'https://sapl.al.pi.leg.br/materia';
const HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (compatible; MonitorLegislativo/1.0; +https://monitorlegislativo.com.br)',
};

function carregarEstado() {
  if (fs.existsSync(ARQUIVO_ESTADO)) {
    return JSON.parse(fs.readFileSync(ARQUIVO_ESTADO, 'utf8'));
  }
  return { proposicoes_vistas: [], ultima_execucao: '' };
}

function salvarEstado(estado) {
  fs.writeFileSync(ARQUIVO_ESTADO, JSON.stringify(estado, null, 2));
}

function prioridadeTipoEmail(tipo) {
  const t = String(tipo || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();

  if (/^(PL|PLO)(\b|$)/.test(t) || /^PROJETO DE LEI( ORDINARIA)?$/.test(t)) return 0;
  if (/^PLC(\b|$)/.test(t) || /^PROJETO DE LEI COMPLEMENTAR/.test(t)) return 1;
  if (/^PEC(\b|$)/.test(t) || /^(PROPOSTA|PROJETO) DE EMENDA (A )?CONSTITUCIONAL/.test(t)) return 2;
  return 10;
}

function compararTiposEmail(a, b) {
  const prioridadeA = prioridadeTipoEmail(a);
  const prioridadeB = prioridadeTipoEmail(b);
  if (prioridadeA !== prioridadeB) return prioridadeA - prioridadeB;
  return String(a || '').localeCompare(String(b || ''), 'pt-BR');
}


const CLIENTES_NOMES_PROPRIOS = [
  'FIRJAN', 'Red Bull', 'Sindicerv', 'Boticario', 'Boticário', 'Abrasel', 'ANBRASEL',
  'Energisa', 'EnergisaLuz', 'SABESP', 'COMGAS', 'COMGÁS', 'Eletromidia', 'Eletromídia',
  'BRT', 'Regenera', 'Nova Infra', 'Seta', 'SETA', 'AkzoNobel', 'Expedia', 'RTSC',
  'Huawei', 'Carrefour', 'JBS', 'Ajinomoto', 'Vibra', 'Mindlab', 'ABVTEX', 'Neoenergia', 'ENEL'
];

function clientesCitadosNaProposicao(p) {
  const texto = [p.cliente, p.clientes, p.autor, p.autores, p.tipo, p.rotulo, p.titulo, p.identificacao, p.ementa]
    .filter(Boolean)
    .join(' ');
  const achados = [];
  for (const nome of CLIENTES_NOMES_PROPRIOS) {
    const escaped = nome.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(^|[^A-Za-zÀ-ÿ0-9])' + escaped + '([^A-Za-zÀ-ÿ0-9]|$)', 'i');
    if (re.test(texto) && !achados.some(a => a.toLowerCase() === nome.toLowerCase())) achados.push(nome);
  }
  return achados;
}

function anotarClientesCitados(proposicoes) {
  for (const p of proposicoes || []) {
    const clientes = clientesCitadosNaProposicao(p);
    p.clientesCitados = clientes;
    if (clientes.length && p.ementa && !String(p.ementa).includes('Cliente citado:')) {
      p.ementa = String(p.ementa).trim() + ' | Cliente citado: ' + clientes.join(', ');
    }
  }
}

async function enviarEmail(novas) {
  anotarClientesCitados(novas);
  if (process.env.DRY_RUN_EMAIL === '1') {
    console.log(`[DRY_RUN_EMAIL] ${novas.length} proposições novas.`);
    novas.slice(0, 20).forEach(p => console.log(`${p.tipo} ${p.numero}/${p.ano} - ${p.link} - ${p.ementa}`));
    return;
  }
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_REMETENTE, pass: EMAIL_SENHA },
  });

  const porTipo = {};
  novas.forEach(p => {
    const tipo = p.tipo || 'OUTROS';
    if (!porTipo[tipo]) porTipo[tipo] = [];
    porTipo[tipo].push(p);
  });

  const linhas = Object.keys(porTipo).sort(compararTiposEmail).map(tipo => {
    const header = `<tr><td colspan="4" style="padding:10px 8px 4px;background:#f0f4f8;font-weight:bold;color:#2c5f2e;font-size:13px;border-top:2px solid #2c5f2e">${tipo} — ${porTipo[tipo].length} proposição(ões)</td></tr>`;
    const rows = porTipo[tipo].map(p =>
      `<tr>
        <td style="padding:8px;border-bottom:1px solid #eee"><a href="${p.link}" style="color:#2c5f2e;text-decoration:none"><strong>${p.numero || '-'}/${p.ano || '-'}</strong></a></td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px;white-space:nowrap">${p.data || '-'}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px">${p.tipo || '-'}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px">${p.ementa || '-'}</td>
      </tr>`
    ).join('');
    return header + rows;
  }).join('');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:900px;margin:0 auto">
      <h2 style="color:#2c5f2e;border-bottom:2px solid #2c5f2e;padding-bottom:8px">
        🏛️ ${CASA_NOME} — ${novas.length} nova(s) proposição(ões)
      </h2>
      <p style="color:#666">Monitoramento automático — ${new Date().toLocaleString('pt-BR')}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="background:#2c5f2e;color:white">
            <th style="padding:10px;text-align:left">Número/Ano</th>
            <th style="padding:10px;text-align:left">Data</th>
            <th style="padding:10px;text-align:left">Tipo</th>
            <th style="padding:10px;text-align:left">Ementa</th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
      </table>
      <p style="margin-top:20px;font-size:12px;color:#999">
        Acesse: <a href="https://sapl.al.pi.leg.br/materia/pesquisar-materia">sapl.al.pi.leg.br</a>
      </p>
    </div>
  `;

  await transporter.sendMail({
    from: `"Monitor ${CASA_NOME}" <${EMAIL_REMETENTE}>`,
    to: EMAIL_DESTINO,
    subject: `🏛️ ${CASA_NOME}: ${novas.length} nova(s) proposição(ões) — ${new Date().toLocaleDateString('pt-BR')}`,
    html,
  });

  console.log(`✅ Email enviado com ${novas.length} proposições novas.`);
}

async function buscarProposicoes() {
  const ano = new Date().getFullYear();
  let pagina = 1;
  const pageSize = 100;
  let todas = [];

  console.log(`🔍 Buscando proposições de ${ano}...`);

  while (true) {
    const url = `${API_BASE}/materia/materialegislativa/?ano=${ano}&page=${pagina}&page_size=${pageSize}&ordering=-id`;
    console.log(`📄 Página ${pagina}: ${url}`);

    const response = await fetch(url, { headers: HEADERS });

    if (!response.ok) {
      throw new Error(`Erro na API: ${response.status} ${response.statusText}`);
    }

    const json = await response.json();

    // A ALE-PI usa wrapper "pagination" em vez do count/next padrão DRF
    const resultados = json.results || [];
    todas = todas.concat(resultados);

    console.log(`📦 Página ${pagina}: ${resultados.length} proposições (total acumulado: ${todas.length})`);

    // Verifica se há próxima página
    const proximaPagina = json.pagination?.next_page || null;
    if (!proximaPagina || resultados.length === 0) break;
    pagina++;
  }

  console.log(`📊 Total recebido: ${todas.length} proposições`);
  return todas;
}

function extrairTipo(p) {
  // __str__ vem como "Indicativo de Projeto de Lei nº 1 de 2026"
  // extrai tudo antes de " nº" ou " de " (o que vier primeiro)
  if (p.__str__) {
    const match = p.__str__.match(/^(.+?)\s+n[ºo°]?\s*\d/i);
    if (match) return match[1].trim().toUpperCase();
    // fallback: tudo antes de " de YYYY"
    const match2 = p.__str__.match(/^(.+?)\s+de\s+\d{4}/i);
    if (match2) return match2[1].trim().toUpperCase();
  }
  return `TIPO ${p.tipo}`;
}

function normalizarProposicao(p) {
  return {
    id: String(p.id),
    tipo: extrairTipo(p),
    numero: p.numero || '-',
    ano: p.ano || '-',
    link: `${MATERIA_BASE}/${p.id}`,
    data: p.data_apresentacao || '-',
    ementa: String(p.ementa || '-').replace(/\s+/g, ' ').trim() || '-',
  };
}

(async () => {
  console.log('🚀 Iniciando monitor ALE-PI...');
  console.log(`⏰ ${new Date().toLocaleString('pt-BR')}`);

  const estado = carregarEstado();
  const idsVistos = new Set(estado.proposicoes_vistas.map(String));

  const proposicoesRaw = await buscarProposicoes();

  if (proposicoesRaw.length === 0) {
    throw new Error('Nenhuma proposição encontrada. Falha provável de coleta/API; workflow deve ficar vermelho.');
  }

  const proposicoes = proposicoesRaw.map(normalizarProposicao).filter(p => p.id);
  console.log(`📊 Total normalizado: ${proposicoes.length}`);

  const novas = proposicoes.filter(p => !idsVistos.has(p.id));
  console.log(`🆕 Proposições novas: ${novas.length}`);

  if (process.env.DRY_RUN_EMAIL === '1') {
    await enviarEmail(novas);
    console.log('DRY_RUN_EMAIL=1 — estado preservado sem alterações.');
    return;
  }

  if (novas.length > 0) {
    novas.sort((a, b) => {
      if (a.tipo < b.tipo) return -1;
      if (a.tipo > b.tipo) return 1;
      return (parseInt(b.numero) || 0) - (parseInt(a.numero) || 0);
    });
    await enviarEmail(novas);
    novas.forEach(p => idsVistos.add(p.id));
    estado.proposicoes_vistas = Array.from(idsVistos);
  } else {
    console.log('✅ Sem novidades. Nada a enviar.');
  }

  estado.ultima_execucao = new Date().toISOString();
  salvarEstado(estado);
})();
