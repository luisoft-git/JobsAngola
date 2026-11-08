'use strict';

// Fonte única de valores válidos. O frontend obtém estes dados em GET /api/meta.

const PROVINCIAS = [
  'Bengo', 'Benguela', 'Bié', 'Cabinda', 'Cuando Cubango', 'Cuanza Norte', 'Cuanza Sul',
  'Cunene', 'Huambo', 'Huíla', 'Icolo e Bengo', 'Luanda', 'Lunda Norte', 'Lunda Sul',
  'Malanje', 'Moxico', 'Moxico Leste', 'Namibe', 'Uíge', 'Zaire'
];

const MODALIDADES = { PRESENCIAL: 'Presencial', REMOTO: 'Remoto', HIBRIDO: 'Híbrido' };

const CONTRATOS = {
  EFETIVO: 'Efetivo',
  TERMO_CERTO: 'Termo certo',
  ESTAGIO: 'Estágio',
  PRESTACAO: 'Prestação de serviços'
};

const SETORES = [
  'Tecnologia', 'Banca e finanças', 'Saúde', 'Educação', 'Construção',
  'Agricultura', 'Comércio', 'Petróleo e gás', 'Outro'
];

const STATUS_CAND = {
  SUBMETIDA: 'Submetida',
  EM_ANALISE: 'Em análise',
  ENTREVISTA: 'Entrevista',
  ACEITA: 'Aceite',
  REJEITADA: 'Rejeitada'
};

const STATUS_EMPRESA = { PENDENTE: 'Em verificação', APROVADO: 'Verificada' };
const STATUS_VAGA = { PENDENTE: 'Em moderação', APROVADA: 'Publicada', REJEITADA: 'Recusada' };

module.exports = {
  PROVINCIAS,
  MODALIDADES,
  CONTRATOS,
  SETORES,
  STATUS_CAND,
  STATUS_EMPRESA,
  STATUS_VAGA
};
