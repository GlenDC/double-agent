if [ -z "$1" ]
then
  echo "Scraper directory not specified"
  echo $USAGE
  exit 0
fi

scraper=$1


docker build -f "Dockerfile-node12-slim" -t "double-agent-scraper-base" .

echo "docker build -f "$scraper/Dockerfile" -t "$scraper" ."
docker build -f "$scraper/Dockerfile" -t "$scraper" .

dockerHost=$(docker run -it --rm "$scraper" getent hosts host.docker.internal | awk '{ print $1 }')
echo 'Local docker internal ip is $dockerHost'

docker run -it --rm --init --cap-add=SYS_ADMIN \
  --add-host="a0.ulixee-test.org:$dockerHost" \
  --add-host="a1.ulixee-test.org:$dockerHost" \
  --add-host="headers.ulixee-test.org:$dockerHost" \
  --add-host="tls.ulixee-test.org:$dockerHost" \
  "$scraper"
