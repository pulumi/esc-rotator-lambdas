FROM golang AS build

# use a deterministic version of zip so that the lambda archive only changes if the file contents change
# https://github.com/timo-reymann/deterministic-zip
COPY --from=timoreymann/deterministic-zip:3.0.1 /deterministic-zip /usr/bin/deterministic-zip

WORKDIR /workspace

COPY go.mod go.sum /workspace/
RUN go mod download

# binary must be named `bootstrap`
# https://docs.aws.amazon.com/lambda/latest/dg/golang-handler.html#golang-handler-naming
COPY . /workspace/
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -tags lambda.norpc -o bootstrap main.go
RUN deterministic-zip -r lambda-deployment-package.zip bootstrap

FROM scratch
# stage the archive for --output
ARG OUTPUT_FILENAME
COPY --from=build /workspace/lambda-deployment-package.zip /$OUTPUT_FILENAME
