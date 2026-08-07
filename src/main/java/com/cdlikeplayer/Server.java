package com.cdlikeplayer;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/** Tiny dependency-free development server for CDPlayer. */
public final class Server {
  private static final Map<String, String> TYPES = new HashMap<String, String>();
  static {
    TYPES.put("html", "text/html; charset=utf-8");
    TYPES.put("css", "text/css; charset=utf-8");
    TYPES.put("js", "application/javascript; charset=utf-8");
    TYPES.put("svg", "image/svg+xml");
    TYPES.put("ico", "image/x-icon");
  }

  public static void main(String[] args) throws IOException {
    final File publicDir = new File("out/public").getCanonicalFile();
    HttpServer server = HttpServer.create(new InetSocketAddress(8080), 0);
    server.createContext("/", new StaticFiles(publicDir));
    server.setExecutor(null);
    server.start();
  }

  private static final class StaticFiles implements HttpHandler {
    private final File root;
    StaticFiles(File root) { this.root = root; }

    public void handle(HttpExchange exchange) throws IOException {
      String rawPath = URLDecoder.decode(exchange.getRequestURI().getPath(), "UTF-8");
      String path = "/".equals(rawPath) ? "/index.html" : rawPath;
      File file = new File(root, path.substring(1)).getCanonicalFile();
      if (!file.getPath().startsWith(root.getPath()) || !file.isFile()) {
        byte[] body = "Not found".getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(404, body.length);
        OutputStream out = exchange.getResponseBody(); out.write(body); out.close();
        return;
      }
      String name = file.getName();
      int dot = name.lastIndexOf('.');
      String extension = dot < 0 ? "" : name.substring(dot + 1).toLowerCase();
      exchange.getResponseHeaders().set("Content-Type", TYPES.containsKey(extension) ? TYPES.get(extension) : "application/octet-stream");
      exchange.getResponseHeaders().set("Cache-Control", "no-store");
      exchange.sendResponseHeaders(200, file.length());
      FileInputStream in = new FileInputStream(file);
      OutputStream out = exchange.getResponseBody();
      byte[] buffer = new byte[8192]; int count;
      while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
      in.close(); out.close();
    }
  }
}
