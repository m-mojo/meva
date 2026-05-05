const ZKLib = require('node-zklib');

class UF100 {
  constructor({ ip, port = 4370, serial }) {
    this.ip = ip; this.port = port; this.serial = serial; this.zk = null;
  }
  async connect() {
    this.zk = new ZKLib(this.ip, this.port, 10000, 4000);
    await this.zk.createSocket();
  }
  async disconnect() {
    if (this.zk) { await this.zk.disconnect().catch(() => {}); this.zk = null; }
  }
  async getAttendances() {
    const data = await this.zk.getAttendances(); return data?.data || [];
  }
  async getUsers() {
    const data = await this.zk.getUsers(); return data?.data || [];
  }
  async setUser({ uid, userId, name, password = '', role = 0, cardno = 0 }) {
    await this.zk.setUser(uid, userId, name, password, role, cardno);
  }
  async deleteUser(uid) { await this.zk.deleteUser(uid); }
}

module.exports = UF100;
