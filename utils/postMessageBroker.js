// A simple message broker wrapping the postMessage API

export default class PostMessageBroker {
  constructor(destination = window.top) {
    this.subscriptions = []
    this.destination = destination

    this.messages = []
  }
  emit(message, payload = {}) {
    this.destination.postMessage({
      error: false,
      message,
      ...payload
    }, '*');
  }
  register(message, callback) {
    const handler = event => {
      event.data.message && event.data.message === message && callback(event)
    }
    window.addEventListener('message', handler)
    this.subscriptions.push(handler)
    return () => window.removeEventListener('message', handler)
  }
  unregisterAll() {
    this.subscriptions.forEach(handler => window.removeEventListener('message', handler))
    this.subscriptions = []
  }
}
