import net from 'node:net';
import {createHash} from 'node:crypto';
const server=net.createServer(socket=>{
 socket.setEncoding('utf8');socket.on('error',()=>{});socket.write('220 synthetic.local ESMTP\r\n');let pending='',data=false,message=[];
 socket.on('data',chunk=>{pending+=chunk;while(pending.includes('\r\n')){const end=pending.indexOf('\r\n'),line=pending.slice(0,end);pending=pending.slice(end+2);
  if(data){if(line==='.') {data=false;const text=message.join('\r\n');message=[];console.log(JSON.stringify({event:'synthetic.mail',messageId:text.match(/^Message-ID:\s*(.+)$/im)?.[1],sha256:createHash('sha256').update(text).digest('hex'),bytes:Buffer.byteLength(text)}));socket.write('250 2.0.0 accepted\r\n');}else message.push(line);}
  else if(/^EHLO|^HELO/i.test(line))socket.write('250-synthetic.local\r\n250 SIZE 10485760\r\n');
  else if(/^MAIL FROM:|^RSET|^NOOP/i.test(line))socket.write('250 OK\r\n');
  else if(/^RCPT TO:/i.test(line))socket.write(/@example\.invalid>/i.test(line)?'250 OK\r\n':'550 Synthetic recipients only\r\n');
  else if(/^DATA$/i.test(line)){data=true;socket.write('354 End with dot\r\n');}
  else if(/^QUIT$/i.test(line))socket.end('221 Bye\r\n');else socket.write('502 Unsupported\r\n');
 }});
});server.listen(2525,'0.0.0.0',()=>console.log('synthetic SMTP ready'));
