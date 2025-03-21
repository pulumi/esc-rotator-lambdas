FROM node:20-alpine AS build

# use a deterministic version of zip so that the lambda archive only changes if the file contents change
# https://github.com/timo-reymann/deterministic-zip
COPY --from=timoreymann/deterministic-zip:latest /deterministic-zip /usr/bin/deterministic-zip

WORKDIR /workspace
COPY . /workspace

RUN yarn install
RUN yarn run build

# only include production dependencies in the final archive
RUN yarn install --production
RUN deterministic-zip -r lambda-deployment-package.zip dist/ node_modules/

FROM scratch
# stage the archive for --output
ARG OUTPUT_FILENAME
COPY --from=build /workspace/lambda-deployment-package.zip /$OUTPUT_FILENAME
