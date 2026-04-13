import Foundation
import Combine

final class WebSocketClient: NSObject {
    private var url: URL
    private var task: URLSessionWebSocketTask?
    private var session: URLSession!
    private var reconnectAttempts = 0
    private var isClosed = false

    let events = PassthroughSubject<WsMessage, Never>()
    let connectionState = CurrentValueSubject<Bool, Never>(false)

    init(url: URL) {
        self.url = url
        super.init()
        let cfg = URLSessionConfiguration.default
        self.session = URLSession(configuration: cfg, delegate: self, delegateQueue: .main)
    }

    func updateURL(_ newURL: URL) {
        close()
        self.url = newURL
        connect()
    }

    func connect() {
        isClosed = false
        let task = session.webSocketTask(with: url)
        self.task = task
        task.resume()
        receiveLoop()
    }

    func close() {
        isClosed = true
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        connectionState.send(false)
    }

    private func receiveLoop() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure:
                self.connectionState.send(false)
                self.scheduleReconnect()
            case .success(let message):
                self.connectionState.send(true)
                self.reconnectAttempts = 0
                switch message {
                case .string(let s):
                    if let data = s.data(using: .utf8) {
                        self.decodeAndPublish(data)
                    }
                case .data(let d):
                    self.decodeAndPublish(d)
                @unknown default:
                    break
                }
                self.receiveLoop()
            }
        }
    }

    private func decodeAndPublish(_ data: Data) {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = obj["type"] as? String else { return }
        let ts = obj["ts"] as? Double
        events.send(WsMessage(type: type, ts: ts))
    }

    private func scheduleReconnect() {
        guard !isClosed else { return }
        reconnectAttempts += 1
        let delay = min(pow(2.0, Double(reconnectAttempts)), 30.0)
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self, !self.isClosed else { return }
            self.connect()
        }
    }
}

extension WebSocketClient: URLSessionWebSocketDelegate {
    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        connectionState.send(true)
        reconnectAttempts = 0
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        connectionState.send(false)
        scheduleReconnect()
    }
}
