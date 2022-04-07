const { GROUP_TOKEN, USER_TOKEN, GROUPS, ADMIN_IDS, PUBLIC_ID, START_HOUR, END_HOUR } = require('./config');
const { VK, Keyboard } = require('vk-io');
const moment = require('moment');
const fs = require('fs');
const vk = new VK({
  token: GROUP_TOKEN,
  apiLimit: 20
});
const commands = [];
const session = {};
let posts = require('./posts.json');
const page = new VK({
  token: USER_TOKEN,
  apiMode: 'parallel'
});
const poster = new VK({
  token: USER_TOKEN
});
const groups = [];
const checkPublics = async () => {
  for (const group of GROUPS) {
    const response = await vk.snippets.resolveResource(group).catch(e => undefined);

    if (!response || response.type !== 'group') {
      console.log('Проблемы с', group);
      continue;
    }

    groups.push(-response.id);
  }
}
checkPublics();
let HOURS = {};
for (let s = START_HOUR; s < END_HOUR + 1; s++) {
  HOURS[s] = false;
}
let HOUR_NOW = (new Date()).getHours();
vk.updates.startPolling();
vk.updates.on('message', async (ctx) => {
  if (ctx.isOutbox || !ctx.text) return;
  
  if (!session[ctx.senderId]) {
    session[ctx.senderId] = {}
  }

  ctx.session = session[ctx.senderId];

  ctx.command = ctx.messagePayload && ctx.messagePayload.command ?
    ctx.messagePayload.command : null;

  if (!ctx.command) {
    const textCommand = findTextCommand(ctx.text);

    if (!textCommand) return;

    try {
      await textCommand.run(ctx);
    } catch (e) { console.log(e) };
    return;
  }

  const buttonCommand = findButtonCommand(ctx.command);
  if (!buttonCommand) return;

  try {
    await buttonCommand.run(ctx);
  } catch (e) { console.log(e) };
  return;
});
const keyboard = Keyboard.keyboard;
const button = (label, command, color = null) => Keyboard.textButton({ label, payload: { command }, color });
const unixTime = () => Math.floor(Date.now() / 1000);
const randomInt = (x, y) => y ? Math.round(Math.random() * (y - x)) + x : Math.round(Math.random() * x);
const randomItem = (array) => array[randomInt(array.length - 1)];
const BUTTON_FUNCTION = 'button';
const TEXT_FUNCTION = 'text';
const onCommand = (pattern, run) => commands.push({ pattern, run, type: TEXT_FUNCTION });
const onButton = (slug, run) => commands.push({ slug, run, type: BUTTON_FUNCTION });
const findTextCommand = (text) => {
  for (const command of commands) {
    if (command.type === TEXT_FUNCTION && command.pattern.test(text)) {
      return command;
    }
  }

  return null;
}
const findButtonCommand = (slug) => {
  for (const command of commands) {
    if (command.type === BUTTON_FUNCTION && command.slug === slug) {
      return command;
    }
  }

  return null;
}
let LAST_POST_DATE = 0;
onCommand(/.*/i, (ctx) => {
  if (ctx.session.step !== 'writeComment') {
    return;
  }
  ctx.session.post.textMessage = ctx.text;
  ctx.session.step = null;
  const post = ctx.session.post;
  ctx.sendPhoto(post.attachment.url, {
    message: `Хотите опубликовать этот пост с текстом <<${ctx.text}>>`,
    keyboard: keyboard([
      [button('Опубликовать', 'confirmPost', Keyboard.POSITIVE_COLOR), button('Отредактировать', 'selectThisPost', Keyboard.PRIMARY_COLOR)],
      [button('Отменить', 'nextPost', Keyboard.NEGATIVE_COLOR)]
    ])
  });
});
onButton('start', (ctx) => {
  if (!ADMIN_IDS.includes(ctx.senderId)) return;
  ctx.send('Привет!', {
    keyboard: keyboard([
      [button('Получить пост', 'nextPost')]
    ])
  });
});
onButton('nextPost', (ctx) => {
  if (groups.length === 0) return ctx.send('Паблики не заполнены');
  page.api.wall.get({
    owner_id: randomItem(groups),
    count: 50
  }).then(({ items }) => {
    const post = randomItem(items.filter(x => x.attachments && x.attachments.length > 0));
    const images = post.attachments.filter(x => x.type === 'photo');
    if (images.length === 0) {
      return ctx.send('Ошибка получения поста');
    }
    const image = images[0].photo.sizes.sort((a, b) => b.width - a.width)[0]  
    ctx.session.post = {
      textMessage: '',
      attachment: image,
    }
    ctx.sendPhoto(image.url, {
      message: `Хотите опубликовать данный пост? (Взято из vk.com/club${Math.abs(post.owner_id)})`,
      keyboard: keyboard([
        [button('Опубликовать', 'selectThisPost', Keyboard.POSITIVE_COLOR), button('Дальше', 'nextPost', Keyboard.PRIMARY_COLOR)]
      ])
    });
  }).catch(e => {
    console.log(e);
    ctx.send('Ошибка получения поста');
  });
});
onButton('selectThisPost', (ctx) => {
  ctx.session.step = 'writeComment';
  ctx.send('Хорошо, напиши комментарий к записи', { keyboard: keyboard([]) });
});
onButton('confirmPost', (ctx) => {
  let post = ctx.session.post;
  post.postDate = (LAST_POST_DATE === 0 ? unixTime() : LAST_POST_DATE) + 3600;
  post.posted = false;
  post.uid = randomInt(99999999999);
  posts.push(post);
  LAST_POST_DATE = post.postDate;
  fs.writeFileSync('./posts.json', JSON.stringify(posts, null, '\t'));
  ctx.send(`Пост будет опубликован ${moment(post.postDate * 1000).format('HH:mm DD.MM.YYYY')}`, {
    keyboard: keyboard([
      [button('Получить пост', 'nextPost')]
    ])
  });
});
const checkHours = () => {
  for (let key in HOURS) {
    HOURS[key] = key == HOUR_NOW;
  }
}
setInterval(() => {
  for (let post of posts) {
    if (post.posted) continue;
    if (HOURS[HOUR_NOW] === undefined) continue;
    if (HOURS[HOUR_NOW] === true) continue;

    HOURS[HOUR_NOW] = true;
    checkHours();

    poster.upload.wallPhoto({
      group_id: PUBLIC_ID,
      source: post.attachment.url,
    }).then(response => {
      poster.api.wall.post({
        owner_id: -PUBLIC_ID,
        message: post.textMessage,
        attachments: `photo${response.ownerId}_${response.id}`
      }).then((response) => {
        post.posted = true;
        fs.writeFileSync('./posts.json', JSON.stringify(posts, null, '\t'));
        console.log('posted');
      }).catch(console.log);
    }).catch(console.log);
  }
}, 5000);