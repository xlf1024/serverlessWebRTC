class ServerlessRtcNetwork extends EventTarget{
	constructor(id){
		super();
		this.allpeers = {};
		this.directpeers = {};
		this.createdpeers = {};
		this.id = id || createID();
		this.lastMessageId = 0;
	}
	sendMessage(msg, to = -1){
		this._onmessage({data:JSON.stringify({from: this.id, to:to, content:msg, id: ++this.lastMessageId})});
	}
	_onmessage(evt){
		let message = JSON.parse(evt.data);
		let {from, to, id} = message;
		if(!this.allpeers[from]) this.allpeers[from] = {lastMessageId:0};
		if(this.allpeers[from].lastMessageId < id){
			this.allpeers[from].lastMessageId = id;
			for(let peerId in this.directpeers){
				let peer = this.directpeers[peerId];
				peer.controlChannel.send(JSON.stringify(message))
			}
			if(to == this.id || to == -1){
				this.dispatchEvent(new messageEvent(message));
			}
			console.log(message);
		}
		
	}
	async createInvite(id){
		if(!id) id = createID();
		
		let peer = new Peer(this, id);
		this.createdpeers[peer.id] = peer;
		let {invite, respond} = await peer.createInvite();
		return {invite, respond}
	}
	async answerInvite(invite, id){
		if(!id) id = createID();
		
		let peer = new Peer(this, id);
		this.createdpeers[peer.id] = peer;
		let answer = await peer.answerInvite(invite);
		return answer;
	}
	async _registerPeer(peer){
		this.directpeers[peer.id] = peer;
		this.dispatchEvent(new newPeerEvent(peer.id));
	}
}

class newPeerEvent extends Event{
	constructor(id){
		super("newPeer");
		this.peerId = id;
	}
}
class messageEvent extends Event{
	constructor(message){
		super("message");
		this.message = message;
	}
}
function createID(){
	return Math.ceil(Math.random() * Number.MAX_SAFE_INTEGER);
}

class Peer{
	constructor(network, id){
		this.network = network;
		this.id = id;
		this.rtcConnection = new RTCPeerConnection();
		this.rtcConnection.__id = id;
		this.controlChannel = this.rtcConnection.createDataChannel("Control",{"negotiated":true, "id":1024});
		this.lastMessageId = 0;
	}
	async createInvite(){
		let rtcOffer = await this.rtcConnection.createOffer();
		await this.rtcConnection.setLocalDescription(rtcOffer);
		await promisePropertyValue(this.rtcConnection, "iceGatheringState", "complete");
		let packedLocalSDP = packSDP(this.rtcConnection.localDescription);
		
		let respond = (async function(packedRemoteSDP){
			let remoteSDP = unpackSDP(packedRemoteSDP);
			await this.rtcConnection.setRemoteDescription(remoteSDP);
		}).bind(this);
		
		this.completeConnection();
		
		return({invite: packedLocalSDP, respond: respond});
	}
	async answerInvite(packedRemoteSDP){
		let remoteSDP = unpackSDP(packedRemoteSDP);
		await this.rtcConnection.setRemoteDescription(remoteSDP);
		let rtcAnswer = await this.rtcConnection.createAnswer();
		await this.rtcConnection.setLocalDescription(rtcAnswer);
		await promisePropertyValue(this.rtcConnection, "iceGatheringState", "complete");
		let packedLocalSDP = packSDP(this.rtcConnection.localDescription);
		
		this.completeConnection();
		
		return packedLocalSDP;
	}
	
	async completeConnection(){
		await promisePropertyValue(this.rtcConnection, "connectionState", "connected");
		await promiseEvent(this.controlChannel, "open");
		await new Promise((resolve, reject)=>setTimeout(resolve, 1000))
		this.controlChannel.send(JSON.stringify({id:this.network.id}));
		let message = await promiseEvent(this.controlChannel, "message");
		this.id = JSON.parse(message.data).id;
		this.network._registerPeer(this);
		this.controlChannel.addEventListener("message", this.network._onmessage.bind(this.network));
	}
}
function promisePropertyValue(object, propertyName, value, eventName){
	if(!eventName) eventName = propertyName.toLowerCase() + "change";
	return new Promise((resolve, reject) => {
		checkState = (evt) => {
			console.log(object, propertyName, value, object[propertyName], evt)
			if(object[propertyName] == value){
				resolve(object);
			}
		}
		checkState({});
		object.addEventListener(eventName, checkState);
		//object.addEventListener(eventName, evt => checkState(evt)); somehow makes events for all instances arrive at the same object. WHY? Wrong compiler optimizations?
	})
}
function promiseEvent(object, eventName){
	return new Promise((resolve, reject) => {
		object.addEventListener(eventName, resolve, {once:true});
	})
}
function packSDP(sdp){
	return btoa(JSON.stringify(sdp));
}
function unpackSDP(packedSDP){
	return JSON.parse(atob(packedSDP));
}