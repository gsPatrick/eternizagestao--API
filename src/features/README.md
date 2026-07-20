# src/features/

Uma pasta por capacidade de negócio, em **kebab-case**, contendo:

```
<nome-feature>/
├── <nome>.routes.js      # define o Router da feature
├── <nome>.controller.js  # só HTTP (status, body, validação superficial)
├── <nome>.service.js     # regras de negócio, transações Sequelize
└── (opc.) <nome>.constants.js · <nome>.helper.js
```

Regras:
- Controller nunca chama integração externa direto — sempre via `src/providers/`.
- Nova feature = nova pasta aqui + montagem em `src/routes/index.js` + doc em `src/documentacao/features/`.
- O mapa completo e a ordem de implementação estão em `src/documentacao/MAPA-DE-FEATURES.md`.
