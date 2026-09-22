# Demo and interview notes

Run `npm run demo:record` with a clean, basic-mode local stack. The script records
a real browser, two transfers, manual pause and an actual failed PATCH after
switching the network offline. It writes the recording and timestamped event
timeline under `artifacts/demo`. The 70-second capture has no simulated progress.
Use `ffmpeg` to convert WebM to H.264 MP4 for the release asset.

## English narration

“This is Resume Proof, a local experiment in recovering uploads. Two files can
progress independently. The light track is what the browser sent; the blue track
is what the server confirmed. I can pause without discarding confirmed data.

Now the connection actually drops. A failed request doesn't tell us whether the
server accepted its bytes, so the client asks for the current offset and continues
there. Reloading also works, after I select and hash the original file again.

Finishing the transfer isn't the final check. The server reads the stored object
and compares its size and SHA-256 with the original. The download is checked once
more in the browser. Optional ClamAV scanning has its own verdict; errors never
become clean results. The repository includes experiments reproducing these
failure cases, with their measurement boundaries and limitations.”

## Roteiro em português

“Este é o Resume Proof, um experimento local de recuperação de uploads. Dois
arquivos avançam de forma independente. A faixa clara mostra o que o navegador
enviou; a azul, o que o servidor confirmou. Posso pausar sem descartar esses dados.

Agora a conexão realmente cai. Uma requisição falha não informa se seus bytes
foram aceitos. Por isso o cliente consulta o offset atual e continua daquele
ponto. Após recarregar a página, seleciono o original e confiro seu conteúdo.

Terminar a transferência ainda não basta. O servidor lê o objeto armazenado e
compara tamanho e SHA-256. O download é conferido novamente no navegador.
O ClamAV opcional tem um resultado separado: erro não significa arquivo limpo.
O repositório traz testes que reproduzem essas falhas e explicam seus limites.”

## Questions worth being able to answer

- Why can a lost response still correspond to a successful write?
- Why isn't a filename fingerprint or multipart ETag an integrity proof?
- What extra work would direct-to-S3 and multiple tusd replicas require?
- How do pause, cancellation, expiration and quarantine differ?
- Which observations are measured, and which deployment claims remain untested?
