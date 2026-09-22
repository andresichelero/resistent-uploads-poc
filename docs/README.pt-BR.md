# Resume Proof — uploads com pausa e retomada

Uma demonstração local de recuperação de uploads após perda de conexão, com
vários arquivos simultâneos, comparação SHA-256 e antivírus opcional.

```sh
docker compose up --build -d --wait
```

Abra http://localhost:3000. Envie um arquivo, pause e retome; depois teste uma
queda real pelo modo Offline das ferramentas de desenvolvedor. Ao recarregar a
página, selecione novamente o original. Conteúdo diferente não é aceito como
continuação, mesmo quando nome e tamanho coincidem.

A faixa clara indica bytes enviados. A azul indica os confirmados pelo servidor.
O tempo estimado cobre a transferência; a verificação acontece em uma etapa própria.
O limite é 100 MiB por arquivo, com retenção de 24 horas após a última atividade.

Para ClamAV real (reserve aproximadamente 4 GiB para o scanner):

```sh
docker compose -f compose.yaml -f compose.antivirus.yaml --profile antivirus up -d --wait --wait-timeout 240
```

O modo básico informa que o antivírus não foi executado. No modo completo,
detecção, erro e análise inconclusiva bloqueiam download. Hash idêntico não prova
que um arquivo é seguro; o resultado do scanner também não é garantia absoluta.

O valor técnico está na separação de responsabilidades, nas decisões explicadas
e nos testes de falhas reais. O protocolo tus e o ClamAV são reutilizados;
a aplicação, a experiência de recuperação e os experimentos são deste projeto.

Veja [execução e testes](../README.md), [decisões](decisions.md),
[resultados](evidence.md) e [roteiro da apresentação](demo-script.md).
