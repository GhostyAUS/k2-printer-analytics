FROM node:18-alpine AS build

WORKDIR /app

COPY package.json ./

RUN npm install

COPY . .

RUN npm run build


FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

RUN rm /etc/nginx/conf.d/default.conf.bak 2>/dev/null; true

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
