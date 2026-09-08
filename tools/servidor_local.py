"""Servidor de desarrollo local para la plataforma.

Hace lo mismo que `python -m http.server`, con dos anadidos:

  1. Resuelve rutas sin extension, igual que el `cleanUrls` de Firebase
     Hosting: /cierre_turno/historico_cierre_turno sirve el archivo
     historico_cierre_turno.html. Asi la URL local y la de produccion
     se comportan igual.
  2. Manda `Cache-Control: no-store`, para que los cambios en CSS y JS
     se vean al recargar. Los assets se enlazan sin `?v=`, y sin esto el
     navegador sirve la version vieja y parece que el arreglo no se aplico.

La raiz servida es siempre la carpeta del sitio (el directorio padre de
tools/), independientemente de desde donde se lance el comando.

Uso:
    python tools/servidor_local.py [puerto]     # puerto por defecto: 5500
"""

import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(SimpleHTTPRequestHandler):
    """Sirve archivos estaticos resolviendo rutas sin extension."""

    def translate_path(self, path):
        destino = super().translate_path(path)
        if os.path.exists(destino):
            return destino

        con_html = destino + ".html"
        if os.path.isfile(con_html):
            return con_html

        como_indice = os.path.join(destino, "index.html")
        if os.path.isfile(como_indice):
            return como_indice

        return destino

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def log_message(self, formato, *args):
        # Silencia los 404 del favicon para no ensuciar la consola.
        # Ojo: log_error() pasa un HTTPStatus como primer argumento, no una
        # cadena, asi que hay que convertirlo antes de buscar dentro.
        if args and "favicon.ico" in str(args[0]):
            return
        super().log_message(formato, *args)


def main():
    puerto = int(sys.argv[1]) if len(sys.argv) > 1 else 5500
    servidor = ThreadingHTTPServer(("", puerto), partial(Handler, directory=RAIZ))
    print(f"Sirviendo {RAIZ}")
    print(f"  http://127.0.0.1:{puerto}/   (Ctrl+C para parar)")
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido.")
        servidor.server_close()


if __name__ == "__main__":
    main()
