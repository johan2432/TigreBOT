import axios from "axios"
import yts from "yt-search"

export default {

command: ["yt2"],

async run(client, message, args){

try{

if(!args || args.length === 0){
return client.sendMessage(message.chat,{
text:"❌ Escribe algo\nEjemplo:\nyt2 bad bunny"
})
}

const query = args.join(" ")

await client.sendMessage(message.chat,{
text:"🔎 Buscando video..."
})

const search = await yts(query)
const video = search.videos[0]

if(!video){
return client.sendMessage(message.chat,{
text:"❌ No encontrado"
})
}

const url = video.url

await client.sendMessage(message.chat,{
text:"⚡ Probando APIs..."
})

const apis = [

`https://cdn.savetube.me/info?url=${url}`,
`https://api.vevioz.com/api/button/mp4/${url}`,
`https://loader.to/ajax/download.php?url=${url}&format=mp4`,
`https://co.wuk.sh/api/json`,
`https://api.cobalt.tools/api/json`,
`https://api-cobalt.islantilla.es/api/json`,
`https://api.yt1s.com/api/ajaxSearch/index?q=${url}&vt=home`,
`https://yt5s.io/api/ajaxSearch`,
`https://keepvid.pro/api`,
`https://y2mate.guru/api/convert`,
`https://snapinsta.app/api`,
`https://ytapi.site/api`,
`https://media-save.net/api`,
`https://videograb.net/api`,
`https://ytdlp.online/api`,
`https://dlpanda.com/api`,
`https://yt-download.org/api`,
`https://tubeapi.com/api`,
`https://mp4downloader.com/api`,
`https://snapvideo.net/api`

]

let download = null

for(const api of apis){

try{

let res

if(api.includes("cobalt")){
res = await axios.post(api,{url:url},{timeout:10000})
}else{
res = await axios.get(api,{timeout:10000})
}

if(res.data){

download =
res.data.url ||
res.data.download ||
res.data.result ||
res.data.link ||
res.data.video

if(download) break

}

}catch(e){
continue
}

}

if(!download){
return client.sendMessage(message.chat,{
text:"❌ Ninguna API funcionó"
})
}

await client.sendMessage(message.chat,{
video:{url:download},
caption:`🎬 ${video.title}`
})

}catch(e){

console.log("ERROR yt2:",e)

client.sendMessage(message.chat,{
text:"❌ Error en descarga"
})

}

}

}
